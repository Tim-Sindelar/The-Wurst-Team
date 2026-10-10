import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { TiltCorrection, orientationQuaternion } from '../src/ar/orientation';

const DEG = Math.PI / 180;
const UP = new Vector3(0, 1, 0);

/** Heading (deg) of the camera's view direction (-z) in the AR world (x east, y up, z south). */
const heading = (q: Quaternion) => {
  const f = new Vector3(0, 0, -1).applyQuaternion(q);
  return Math.atan2(f.x, -f.z) / DEG;
};

/** Accelerometer of a still phone: "up" in the device frame, m/s² (W3C: +9.81 on z lying face up). */
const accelerometer = (device: Quaternion) => UP.clone().multiplyScalar(9.81).applyQuaternion(device.clone().invert());

describe('TiltCorrection', () => {
  it('measures up as the W3C accelerometer does', () => {
    const flat = orientationQuaternion(new Quaternion(), 0, 0, 0, 0);
    const a = accelerometer(flat);
    expect(a.z).toBeCloseTo(9.81, 6);
  });

  // Phone upright, looking east and rolled 12 deg; the sensors think it is rolled 4 deg more and pitched 3 deg.
  const truth = orientationQuaternion(new Quaternion(), 270, 88, 12, 0);
  const error = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 4 * DEG)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 3 * DEG));
  const sensed = error.clone().multiply(truth);

  const run = (tilt: TiltCorrection, rate: number, seconds: number) => {
    const a = accelerometer(truth);
    for (let t = 0; t <= seconds * 1000; t += 16) {
      tilt.motion(a.x, a.y, a.z, rate, t);
      tilt.update(sensed, t);
    }
    return tilt.q.clone().multiply(sensed);
  };

  it('turns a still phone onto gravity within a second, without changing the heading', () => {
    const corrected = run(new TiltCorrection(), 2, 1.5);
    // The device's up as measured, in the corrected world: must be the world's up.
    const measuredUp = accelerometer(truth).normalize().applyQuaternion(corrected);
    expect(measuredUp.angleTo(UP) / DEG).toBeLessThan(0.1);
    // Camera axes match the truth up to a rotation about the vertical (the heading's job).
    expect(new Vector3(0, 1, 0).applyQuaternion(corrected).y).toBeCloseTo(new Vector3(0, 1, 0).applyQuaternion(truth).y, 3);
    expect(Math.abs(heading(corrected) - heading(sensed))).toBeLessThan(1);
  });

  it('keeps the correction while the phone turns', () => {
    const tilt = new TiltCorrection();
    run(tilt, 120, 1);
    expect(tilt.angle).toBeLessThan(0.01);
  });
});
