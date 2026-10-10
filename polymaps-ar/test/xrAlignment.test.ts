import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { XrAlignment, yawOf } from '../src/ar/xrAlignment';

const UP = new Vector3(0, 1, 0);

describe('XR alignment', () => {
  it('recovers the rotation and offset between the world and the XR tracking frame', () => {
    // Ground truth: xr = R(yaw) · world + t
    const yaw = 0.7;
    const t = new Vector3(3, 0, -5);
    const align = new XrAlignment(1, 1); // no smoothing: one observation is enough here
    // The phone looks along some world direction; the XR frame sees it rotated by yaw.
    const worldCam = new Quaternion().setFromAxisAngle(UP, -0.4).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.2));
    const xrCam = new Quaternion().setFromAxisAngle(UP, yaw).multiply(worldCam);
    align.updateHeading(xrCam, worldCam, 0);
    expect(align.yaw).toBeCloseTo(yaw, 6);

    const world = new Vector3(10, 1.5, -20);
    const xr = world.clone().applyAxisAngle(UP, yaw).add(t);
    align.updatePosition(xr, world, 1);
    expect(align.ready).toBe(true);
    expect(align.t.x).toBeCloseTo(t.x, 6);
    expect(align.t.z).toBeCloseTo(t.z, 6);

    // A second point of the walk maps consistently.
    const world2 = new Vector3(-4, 1.5, 7);
    const mapped = world2.clone().applyAxisAngle(UP, align.yaw!).add(align.t);
    const expected = world2.clone().applyAxisAngle(UP, yaw).add(t);
    expect(mapped.distanceTo(new Vector3(expected.x, mapped.y, expected.z))).toBeLessThan(1e-6);
  });

  it('measures yaw as the rotation that turns -z into the view direction', () => {
    expect(yawOf(new Quaternion())).toBeCloseTo(0);
    expect(yawOf(new Quaternion().setFromAxisAngle(UP, Math.PI / 2))).toBeCloseTo(Math.PI / 2);
  });

  it('uses each fix only once', () => {
    const align = new XrAlignment(1, 0.5);
    align.updateHeading(new Quaternion(), new Quaternion(), 0);
    align.updatePosition(new Vector3(1, 0, 0), new Vector3(), 5);
    align.updatePosition(new Vector3(3, 0, 0), new Vector3(), 5); // same fix time: ignored
    expect(align.t.x).toBeCloseTo(1);
    align.updatePosition(new Vector3(3, 0, 0), new Vector3(), 6);
    expect(align.t.x).toBeCloseTo(2);
  });
});

describe('device orientation', () => {
  it('maps an upright phone to the world frame (x east, y up, z south)', async () => {
    const { orientationQuaternion } = await import('../src/ar/orientation');
    const forward = (alpha: number) => new Vector3(0, 0, -1).applyQuaternion(orientationQuaternion(new Quaternion(), alpha, 90, 0, 0));
    const north = forward(0);
    expect(north.z).toBeCloseTo(-1);
    const west = forward(90); // alpha grows counter-clockwise seen from above
    expect(west.x).toBeCloseTo(-1);
    const up = new Vector3(0, 1, 0).applyQuaternion(orientationQuaternion(new Quaternion(), 0, 90, 0, 0));
    expect(up.y).toBeCloseTo(1);
  });
});
