/**
 * Using a visual fix in the AR view.
 *
 * The VPS returns the camera's full orientation at the moment the frame was taken. The overlay's
 * pitch and roll come from gravity and are good; its heading is the weak part (compass indoors).
 * So the visual fix only corrects the heading: the rotation about the vertical that turns the
 * camera as rendered at capture time onto the visual one. The gyro carries it from there.
 *
 * Position: the beacon fix wanders by metres, the visual one is good to decimetres. The offset
 * between them at capture time is applied to later beacon fixes and fades out, so the overlay
 * stays put after a visual fix and slowly hands back to the beacons if no new one arrives.
 */
import type { Quaternion } from 'three';
import { yawOf } from '../ar/xrAlignment';

const DEG = 180 / Math.PI;

/** Degrees to add to the heading offset (rotation about +y, as the AR view's yawFix). */
export function headingCorrection(renderedAtCapture: Quaternion, visual: Quaternion): number {
  const d = yawOf(visual) - yawOf(renderedAtCapture);
  return Math.atan2(Math.sin(d), Math.cos(d)) * DEG;
}

export class VisualOffset {
  /** Metres east / north added to beacon positions. */
  x = 0;
  y = 0;
  private t = -Infinity;

  constructor(
    /** Full strength for this long, ms. */
    private readonly holdMs = 15_000,
    /** Then fades out over this long, ms. */
    private readonly fadeMs = 30_000,
  ) {}

  /** Visual position and the beacon position at capture time, both in local metres (x east, y north). */
  set(visual: { x: number; y: number }, beacon: { x: number; y: number }, now: number): void {
    this.x = visual.x - beacon.x;
    this.y = visual.y - beacon.y;
    this.t = now;
  }

  reset(): void {
    this.x = this.y = 0;
    this.t = -Infinity;
  }

  weight(now: number): number {
    const age = now - this.t;
    if (age <= this.holdMs) return 1;
    return Math.max(0, 1 - (age - this.holdMs) / this.fadeMs);
  }

  apply(p: { x: number; y: number }, now: number): { x: number; y: number } {
    const w = this.weight(now);
    return { x: p.x + w * this.x, y: p.y + w * this.y };
  }
}
