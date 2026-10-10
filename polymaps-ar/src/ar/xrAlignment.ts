/**
 * Aligns the floor plan (world frame: x east, y up, z south) with a WebXR session's tracking space.
 *
 * WebXR (ARCore) tracks the phone smoothly and precisely, but in its own frame: origin where the
 * session started, arbitrary heading. The beacon fix says where we are in the world (noisy, 1 Hz),
 * the compass which way we face (biased indoors). Fitting
 *   xr = R(yaw) · world + t
 * with yaw from compass vs. tracked heading and t from tracked position vs. fix, both low-pass
 * filtered, gives an overlay that moves with tracking quality and is anchored by the beacons.
 */
import { Quaternion, Vector3 } from 'three';

/** Rotation about +y that turns -z into the given orientation's forward direction. */
export function yawOf(q: Quaternion): number {
  const f = new Vector3(0, 0, -1).applyQuaternion(q);
  return Math.atan2(-f.x, -f.z);
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class XrAlignment {
  yaw: number | null = null;
  /** xr = R(yaw) · world + t */
  readonly t = new Vector3();
  private hasT = false;
  private lastFixTime = -1;

  constructor(private readonly yawAlpha = 0.02, private readonly posAlpha = 0.15) {}

  reset(): void {
    this.yaw = null;
    this.hasT = false;
    this.lastFixTime = -1;
  }

  /** Each frame: tracked camera orientation and the compass-based world orientation of the phone. */
  updateHeading(xrCamera: Quaternion, worldCamera: Quaternion | null, manualOffsetRad: number): void {
    if (!worldCamera) {
      if (this.yaw === null) this.yaw = 0;
      return;
    }
    const measured = wrap(yawOf(xrCamera) - yawOf(worldCamera) - manualOffsetRad);
    this.yaw = this.yaw === null ? measured : wrap(this.yaw + this.yawAlpha * wrap(measured - this.yaw));
  }

  /** On each new fix: tracked camera position and the fix in world metres (x east, z south). */
  updatePosition(xrCamera: Vector3, world: Vector3, fixTime: number): void {
    if (this.yaw === null || fixTime === this.lastFixTime) return;
    this.lastFixTime = fixTime;
    const rotated = world.clone().applyAxisAngle(new Vector3(0, 1, 0), this.yaw);
    const t = new Vector3(xrCamera.x - rotated.x, 0, xrCamera.z - rotated.z);
    if (!this.hasT) {
      this.t.copy(t);
      this.hasT = true;
    } else {
      this.t.lerp(t, this.posAlpha);
    }
  }

  get ready(): boolean {
    return this.yaw !== null && this.hasT;
  }
}
