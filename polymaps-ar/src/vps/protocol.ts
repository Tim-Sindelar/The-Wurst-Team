/**
 * Wire format of a localization request: only the features leave the phone, never the image.
 *
 *   "VPS1" | u32 header length | header JSON | f32 keypoints (N x 2) | f32 scores (N) | i8 descriptors (N x 256)
 *
 * Descriptors are unit vectors whose components stay well below 0.5, so they are sent as
 * round(d * DESC_SCALE) clamped to int8 (1 KiB -> 256 B per keypoint; matching is unaffected).
 * Little-endian throughout. The server side is vps/vps/protocol.py.
 */
import type { Features } from './superpoint';
import { DESCRIPTOR_DIM } from './superpoint';

export const DESC_SCALE = 256;

export interface LocalizeRequest {
  features: Features;
  /** Focal length guess in pixels of the feature image (the server refines it). */
  focal: number;
  /** Coarse position from the beacons: the server only searches map images around it. */
  prior: { lng: number; lat: number; levelId: string | null; accuracy: number } | null;
}

export interface LocalizeResponse {
  ok: boolean;
  reason?: string;
  lng?: number;
  lat?: number;
  levelId?: string;
  /** Camera height above the level's floor, metres. */
  height?: number;
  /** Camera rotation in the AR world frame (x east, y up, z south; three.js camera axes). [x, y, z, w] */
  quaternion?: [number, number, number, number];
  /** Heading of the camera's view direction, degrees clockwise from north. */
  heading?: number;
  /** Elevation of the view direction above the horizon, degrees. */
  pitch?: number;
  focal?: number;
  inliers?: number;
  matches?: number;
  /** Map images the query was matched against. */
  candidates?: number;
  /** Server time, ms. */
  ms?: number;
  scene?: string;
}

export function encodeRequest(req: LocalizeRequest): ArrayBuffer {
  const f = req.features;
  const n = f.scores.length;
  const header = new TextEncoder().encode(
    JSON.stringify({ n, width: f.width, height: f.height, focal: req.focal, prior: req.prior, descScale: DESC_SCALE, dim: DESCRIPTOR_DIM }),
  );
  const size = 8 + header.length + n * 8 + n * 4 + n * DESCRIPTOR_DIM;
  const buf = new ArrayBuffer(size);
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  bytes.set([0x56, 0x50, 0x53, 0x31], 0); // "VPS1"
  view.setUint32(4, header.length, true);
  bytes.set(header, 8);
  let o = 8 + header.length;
  for (let i = 0; i < 2 * n; i++, o += 4) view.setFloat32(o, f.keypoints[i], true);
  for (let i = 0; i < n; i++, o += 4) view.setFloat32(o, f.scores[i], true);
  const desc = new Int8Array(buf, o, n * DESCRIPTOR_DIM);
  for (let i = 0; i < desc.length; i++) desc[i] = Math.max(-127, Math.min(127, Math.round(f.descriptors[i] * DESC_SCALE)));
  return buf;
}
