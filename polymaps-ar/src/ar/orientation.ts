/**
 * Phone orientation -> camera rotation in a world frame where x = east, y = up, z = south
 * (so local metres east / north map to (x, -y) on the floor).
 *
 * Android: 'deviceorientationabsolute' gives alpha relative to north.
 * iOS: 'deviceorientation' alpha is relative to the start pose, but webkitCompassHeading is
 * absolute; the difference is tracked as an offset. Indoors the magnetometer is often off by
 * 10-30 degrees (steel, cables), so the user can add a manual heading correction.
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

/** Subscribes to the best orientation source; returns an unsubscribe function. */
export function watchOrientation(onReading: (r: OrientationReading) => void): () => void {
  let iosOffset: number | null = null;
  let gotAbsolute = false;
  const onAbsolute = (e: DeviceOrientationEvent) => {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    gotAbsolute = true;
    onReading({ alpha: e.alpha, beta: e.beta, gamma: e.gamma, absolute: true });
  };
  const onRelative = (e: DeviceOrientationEvent) => {
    if (gotAbsolute || e.alpha == null || e.beta == null || e.gamma == null) return;
    const compass = (e as IOSOrientationEvent).webkitCompassHeading;
    if (typeof compass === 'number' && compass >= 0) {
      // alpha grows counter-clockwise, compass heading clockwise.
      const offset = (((360 - compass - e.alpha) % 360) + 540) % 360 - 180;
      iosOffset = iosOffset === null ? offset : iosOffset + 0.05 * ((((offset - iosOffset) % 360) + 540) % 360 - 180);
    }
    onReading({ alpha: e.alpha + (iosOffset ?? 0), beta: e.beta, gamma: e.gamma, absolute: iosOffset !== null || e.absolute });
  };
  window.addEventListener('deviceorientationabsolute', onAbsolute as EventListener);
  window.addEventListener('deviceorientation', onRelative);
  return () => {
    window.removeEventListener('deviceorientationabsolute', onAbsolute as EventListener);
    window.removeEventListener('deviceorientation', onRelative);
  };
}
