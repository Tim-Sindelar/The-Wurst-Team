/**
 * Phone orientation -> camera rotation in a world frame where x = east, y = up, z = south
 * (so local metres east / north map to (x, -y) on the floor).
 *
 * Android: 'deviceorientationabsolute' gives alpha relative to north.
 * iOS: 'deviceorientation' alpha is relative to the start pose, but webkitCompassHeading is
 * absolute. On both, the gyro-based stream drives the rotation and the compass only slowly corrects
 * the heading (HeadingFusion). Indoors the magnetometer is often off by 10-30 degrees (steel,
 * cables), so the user can add a manual heading correction.
 */
import { Euler, Quaternion, Vector3 } from 'three';

const DEG = Math.PI / 180;
const zee = new Vector3(0, 0, 1);
const euler = new Euler();
const q0 = new Quaternion();
const q1 = new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90 deg around x: camera looks out of the back

/** Same convention as three.js' former DeviceOrientationControls. All angles in degrees. */
export function orientationQuaternion(out: Quaternion, alpha: number, beta: number, gamma: number, screenAngle: number): Quaternion {
  euler.set(beta * DEG, alpha * DEG, -gamma * DEG, 'YXZ');
  out.setFromEuler(euler);
  out.multiply(q1);
  out.multiply(q0.setFromAxisAngle(zee, -screenAngle * DEG));
  return out;
}

export interface OrientationReading {
  /** Rotation around the vertical axis relative to north, degrees (counter-clockwise, as alpha). */
  alpha: number;
  beta: number;
  gamma: number;
  absolute: boolean;
}

type IOSOrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };
type PermissionRequest = { requestPermission?: () => Promise<'granted' | 'denied'> };

/** iOS needs a user gesture to grant motion sensors. Call from a click handler. */
export async function requestOrientationPermission(): Promise<boolean> {
  const ctor = (typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : undefined) as PermissionRequest | undefined;
  if (ctor?.requestPermission) return (await ctor.requestPermission()) === 'granted';
  return typeof DeviceOrientationEvent !== 'undefined';
}

export function screenAngle(): number {
  return (screen.orientation?.angle ?? (window as Window & { orientation?: number }).orientation ?? 0) as number;
}

/**
 * Gyro for rotation, compass only for the long-term heading.
 *
 * 'deviceorientationabsolute' (Android's magnetometer-fused rotation vector) follows every
 * magnetic disturbance indoors: walking past a steel door swings the heading by tens of degrees
 * within seconds, and the overlay with it. 'deviceorientation' (gyro + accelerometer only) is
 * smooth and drifts by only a few degrees per minute. So the overlay uses the relative
 * orientation, turned about the vertical by an offset that slowly follows the compass. Readings
 * taken while the phone turns quickly are skipped: the two sensor streams lag each other, which
 * would show up as a heading error. Once the user lines up walls by hand, the compass is ignored
 * (`locked`) since their alignment is better than any indoor compass.
 */
export class HeadingFusion {
  /** Degrees added to the relative alpha. null until a compass reading arrives. */
  offset: number | null = null;
  locked = false;
  private relative: { alpha: number; beta: number; gamma: number; t: number; q: Quaternion } | null = null;
  /** Recent peak angular speed of the phone, degrees per second. */
  speed = 0;
  private firstCompassT: number | null = null;
  private lastCompassT: number | null = null;

  constructor(
    /** Time constant of the compass correction once settled, seconds. */
    private readonly tau = 20,
    /** Faster time constant for the first seconds, so the start heading is not one noisy sample. */
    private readonly tauStart = 1,
    private readonly startSeconds = 3,
    private readonly maxSpeed = 40,
  ) {}

  /** A gyro-based reading; returns the reading turned to north. `t` in milliseconds. */
  updateRelative(alpha: number, beta: number, gamma: number, t: number): OrientationReading {
    const q = orientationQuaternion(new Quaternion(), alpha, beta, gamma, 0);
    if (this.relative) {
      const dt = (t - this.relative.t) / 1000;
      if (dt > 0) {
        // Peak hold: gate at once when a turn starts, and for a moment after it ends.
        this.speed = Math.max(this.relative.q.angleTo(q) / DEG / dt, this.speed * Math.exp(-dt / 0.3));
      }
    }
    this.relative = { alpha, beta, gamma, t, q };
    return { alpha: alpha + (this.offset ?? 0), beta, gamma, absolute: this.offset !== null };
  }

  /** An absolute (compass-referenced) orientation, e.g. from 'deviceorientationabsolute'. */
  updateAbsolute(alpha: number, beta: number, gamma: number, t: number): void {
    const r = this.relative;
    if (!r || Math.abs(t - r.t) > 100) return;
    // Rotation about the vertical that turns the relative orientation into the absolute one.
    const d = orientationQuaternion(new Quaternion(), alpha, beta, gamma, 0).multiply(r.q.clone().invert());
    const x = new Vector3(1, 0, 0).applyQuaternion(d);
    this.updateOffset(Math.atan2(-x.z, x.x) / DEG, t);
  }

  /** A measured offset (degrees, absolute alpha minus relative alpha). `t` in milliseconds. */
  updateOffset(measured: number, t: number): void {
    if (this.locked && this.offset !== null) return;
    const dt = this.lastCompassT === null ? 0 : Math.min(1, Math.max(0, (t - this.lastCompassT) / 1000));
    this.lastCompassT = t;
    if (this.offset === null) {
      this.offset = wrapDeg(measured);
      this.firstCompassT = t;
      return;
    }
    if (this.speed > this.maxSpeed) return;
    const settling = (t - (this.firstCompassT ?? t)) / 1000 < this.startSeconds;
    const gain = 1 - Math.exp(-dt / (settling ? this.tauStart : this.tau));
    this.offset = wrapDeg(this.offset + gain * wrapDeg(measured - this.offset));
  }
}

function wrapDeg(a: number): number {
  return ((((a + 180) % 360) + 360) % 360) - 180;
}

/** Subscribes to the orientation sensors; returns an unsubscribe function. */
export function watchOrientation(onReading: (r: OrientationReading) => void, fusion = new HeadingFusion()): () => void {
  let gotRelative = false;
  const onAbsolute = (e: DeviceOrientationEvent) => {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    // Without a gyro-only stream, fall back to the compass-fused one as it is.
    if (!gotRelative) return onReading({ alpha: e.alpha, beta: e.beta, gamma: e.gamma, absolute: true });
    fusion.updateAbsolute(e.alpha, e.beta, e.gamma, e.timeStamp);
  };
  const onRelative = (e: DeviceOrientationEvent) => {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    // Some browsers (Firefox on Android) only have the absolute stream, under this name.
    if (e.absolute) return onReading({ alpha: e.alpha, beta: e.beta, gamma: e.gamma, absolute: true });
    gotRelative = true;
    const reading = fusion.updateRelative(e.alpha, e.beta, e.gamma, e.timeStamp);
    // iOS: alpha is relative to the start pose, webkitCompassHeading (clockwise) is absolute.
    const compass = (e as IOSOrientationEvent).webkitCompassHeading;
    if (typeof compass === 'number' && compass >= 0) fusion.updateOffset(360 - compass - e.alpha, e.timeStamp);
    onReading(reading);
  };
  window.addEventListener('deviceorientationabsolute', onAbsolute as EventListener);
  window.addEventListener('deviceorientation', onRelative);
  return () => {
    window.removeEventListener('deviceorientationabsolute', onAbsolute as EventListener);
    window.removeEventListener('deviceorientation', onRelative);
  };
}
