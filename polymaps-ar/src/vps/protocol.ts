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
  /** Debug mode: the server answers with its intermediate results and stores the query under this id. */
  debug?: string;
}

/** The localizer's intermediate results in debug mode (vps/vps/localizer.py). */
export interface LocalizeDebug {
  keypoints: number;
  timing: Record<string, number>;
  prior?: { x: number; y: number; levelId: string | null; radius: number };
  candidates?: { name: string; dist: number }[];
  /** Most similar map images; the `used` ones were matched (enough mutual NN matches). */
  shortlist?: { name: string; mnn: number; used: boolean; center: [number, number, number]; matches?: number; matches3d?: number }[];
  /** Query keypoints with a 2D-3D match. */
  matchedKp?: number[];
  /** Query keypoints of the pose's inliers, and where the pose projects their 3D points. */
  inlierKp?: number[];
  reprojected?: [number, number][];
  reprojError?: { median: number; p90: number };
  inlierDepth?: { median: number; min: number; max: number };
  solvers?: Record<string, { inliers: number; focal: number; fov: number } | null>;
  solver?: string | null;
  /** The pose found, also when it was rejected. */
  pose?: { lng: number; lat: number; levelId: string; height: number; heading: number; pitch: number; focal: number; priorDist?: number };
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
  debug?: LocalizeDebug;
  /** Debug mode: the server kept the query, the frame and context can be uploaded for it. */
  debugStored?: boolean;
}

export function encodeRequest(req: LocalizeRequest): ArrayBuffer {
  const f = req.features;
  const n = f.scores.length;
  const header = new TextEncoder().encode(
    JSON.stringify({ n, width: f.width, height: f.height, focal: req.focal, prior: req.prior, descScale: DESC_SCALE, dim: DESCRIPTOR_DIM, ...(req.debug ? { debug: req.debug } : {}) }),
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
