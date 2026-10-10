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

const G = 9.81;
const WORLD_UP = new Vector3(0, 1, 0);

/**
 * Roll and pitch from gravity.
 *
 * The browser's gyro-based orientation (Android's game rotation vector) corrects its tilt from the
 * accelerometer only very slowly: after the phone is rolled and held still, the overlay can stay
 * tilted by degrees for a long time, while the accelerometer alone (what Phyphox's inclination
 * shows) knows the tilt of a still phone to a fraction of a degree. So whenever the phone is
 * nearly still (no rotation, total acceleration ~ g), the orientation is turned about a horizontal
 * axis until the measured "up" is up; while it moves, the last correction is kept and the gyro
 * carries the motion. Heading is unaffected (HeadingFusion, compass, visual fixes).
 */
export class TiltCorrection {
  /** World-frame rotation to apply in front of the sensor orientation. */
  readonly q = new Quaternion();
  /** Low-passed "up" in the device frame (x right, y top of the screen, z out of it), m/s². */
  private up: Vector3 | null = null;
  private rate = 0;
  private lastMotionT: number | null = null;
  private lastUpdateT: number | null = null;
  private readonly target = new Quaternion();
  private readonly w = new Vector3();

  constructor(
    /** Time constant of the correction while still, seconds. */
    private readonly tau = 0.3,
    /** Time constant of the gravity low-pass, seconds. */
    private readonly tauGravity = 0.15,
    /** Rotation rate (deg/s) and acceleration error (m/s²) at which gravity is no longer trusted much. */
    private readonly rateScale = 15,
    private readonly accScale = 0.4,
  ) {}

  /** devicemotion: accelerationIncludingGravity (device frame) and rotation rate magnitude (deg/s). `t` in ms. */
  motion(ax: number, ay: number, az: number, rateDegS: number, t: number): void {
    const dt = this.lastMotionT === null ? 1 : Math.min(1, Math.max(0, (t - this.lastMotionT) / 1000));
    this.lastMotionT = t;
    this.rate = rateDegS;
    const a = new Vector3(ax, ay, az);
    if (!this.up) this.up = a;
    else this.up.lerp(a, 1 - Math.exp(-dt / this.tauGravity));
  }

  /** How much gravity is trusted now, 0..1 (1: phone still). */
  get weight(): number {
    if (!this.up) return 0;
    const acc = (this.up.length() - G) / this.accScale;
    const rate = this.rate / this.rateScale;
    return Math.exp(-acc * acc - rate * rate);
  }

  /** Correction angle, degrees. */
  get angle(): number {
    return (2 * Math.acos(Math.min(1, Math.abs(this.q.w))) * 180) / Math.PI;
  }

  /** `device`: orientationQuaternion(..., screenAngle 0), i.e. the device frame in the world. `t` in ms. */
  update(device: Quaternion, t: number): void {
    const dt = this.lastUpdateT === null ? 0 : Math.min(1, Math.max(0, (t - this.lastUpdateT) / 1000));
    this.lastUpdateT = t;
    const k = this.weight;
    if (!this.up || k < 0.05 || dt === 0) return;
    // Measured up in the world as the sensors see it; the correction turns it onto the true up.
    this.w.copy(this.up).normalize().applyQuaternion(device);
    if (this.w.y < 0) this.w.negate(); // older iOS reports gravity with the opposite sign
    this.target.setFromUnitVectors(this.w, WORLD_UP);
    this.q.slerp(this.target, 1 - Math.exp(-(dt * k) / this.tau));
  }
}

function wrapDeg(a: number): number {
  return ((((a + 180) % 360) + 360) % 360) - 180;
}

/** Subscribes to the orientation sensors; returns an unsubscribe function. */
export function watchOrientation(
  onReadingRaw: (r: OrientationReading) => void,
  fusion = new HeadingFusion(),
  tilt: TiltCorrection | null = null,
): () => void {
  let gotRelative = false;
  const device = new Quaternion();
  const onReading = (r: OrientationReading, t: number) => {
    tilt?.update(orientationQuaternion(device, r.alpha, r.beta, r.gamma, 0), t);
    onReadingRaw(r);
  };
  const onMotion = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity, r = e.rotationRate;
    if (!tilt || a?.x == null || a.y == null || a.z == null) return;
    const rate = r ? Math.hypot(r.alpha ?? 0, r.beta ?? 0, r.gamma ?? 0) : 0;
    tilt.motion(a.x, a.y, a.z, rate, e.timeStamp);
  };
  const onAbsolute = (e: DeviceOrientationEvent) => {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    // Without a gyro-only stream, fall back to the compass-fused one as it is.
    if (!gotRelative) return onReading({ alpha: e.alpha, beta: e.beta, gamma: e.gamma, absolute: true }, e.timeStamp);
    fusion.updateAbsolute(e.alpha, e.beta, e.gamma, e.timeStamp);
  };
  const onRelative = (e: DeviceOrientationEvent) => {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    // Some browsers (Firefox on Android) only have the absolute stream, under this name.
    if (e.absolute) return onReading({ alpha: e.alpha, beta: e.beta, gamma: e.gamma, absolute: true }, e.timeStamp);
    gotRelative = true;
    const reading = fusion.updateRelative(e.alpha, e.beta, e.gamma, e.timeStamp);
    // iOS: alpha is relative to the start pose, webkitCompassHeading (clockwise) is absolute.
    const compass = (e as IOSOrientationEvent).webkitCompassHeading;
    if (typeof compass === 'number' && compass >= 0) fusion.updateOffset(360 - compass - e.alpha, e.timeStamp);
    onReading(reading, e.timeStamp);
  };
  window.addEventListener('deviceorientationabsolute', onAbsolute as EventListener);
  window.addEventListener('deviceorientation', onRelative);
  if (tilt) window.addEventListener('devicemotion', onMotion);
  return () => {
    window.removeEventListener('devicemotion', onMotion);
    window.removeEventListener('deviceorientationabsolute', onAbsolute as EventListener);
    window.removeEventListener('deviceorientation', onRelative);
  };
}
