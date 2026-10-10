/**
 * Visual positioning: SuperPoint features of a camera frame, computed on the phone, are sent to the
 * VPS server (vps/), which matches them against a 3D map built from the LaMAR dataset (ETH HG and
 * CAB) and returns the camera's position and full orientation. The image itself never leaves the
 * phone; a request is ~260 KiB for 1024 keypoints.
 */
import { SuperPointExtractor, toGray, type Features } from './superpoint';
import { encodeRequest, type LocalizeRequest, type LocalizeResponse } from './protocol';

/** Longer side of the image the features are computed on. */
export const FEATURE_MAX_SIDE = 640;
export const MAX_KEYPOINTS = 1024;

/**
 * Focal length in video pixels for an overlay with vertical field of view `fovDeg` drawn over a
 * video shown with `object-fit: cover` in a `viewW` x `viewH` box (and the inverse below).
 */
export function focalFromFov(fovDeg: number, videoW: number, videoH: number, viewW: number, viewH: number): number {
  const s = Math.max(viewW / videoW, viewH / videoH);
  return viewH / 2 / Math.tan((fovDeg * Math.PI) / 360) / s;
}

export function fovFromFocal(focalVideoPx: number, videoW: number, videoH: number, viewW: number, viewH: number): number {
  const s = Math.max(viewW / videoW, viewH / videoH);
  return (360 / Math.PI) * Math.atan(viewH / 2 / (focalVideoPx * s));
}

export interface VpsResult extends LocalizeResponse {
  /** Focal length in video pixels, refined by the server. */
  focalVideo?: number;
  /** Total time on the phone, ms (extraction + upload + server). */
  totalMs: number;
  extractMs: number;
  /** onnxruntime backend on the phone: webgpu or wasm. */
  backend: string;
  bytes: number;
}

export class VpsClient {
  private extractor: Promise<SuperPointExtractor> | null = null;

  constructor(
    /** Relative to the page: the model is served with the app, the endpoint by the VPS server. */
    private readonly modelUrl = 'vps/superpoint.onnx',
    private readonly endpoint = 'vps/localize',
  ) {}

  /** Loads the network (~5 MB, cached by the browser). */
  load(): Promise<SuperPointExtractor> {
    if (!this.extractor) {
      this.extractor = SuperPointExtractor.load(this.modelUrl);
      this.extractor.catch(() => (this.extractor = null));
    }
    return this.extractor;
  }

  /**
   * Localizes one frame. The frame is read synchronously when this is called, so the caller can
   * snapshot its own orientation estimate right before or after for the same instant.
   */
  async localize(source: CanvasImageSource, srcW: number, srcH: number, focalSrcPx: number, prior: LocalizeRequest['prior']): Promise<VpsResult> {
    const t0 = performance.now();
    const { gray, width, height, scaleX } = toGray(source, srcW, srcH, FEATURE_MAX_SIDE);
    const extractor = await this.load();
    const features: Features = await extractor.extract(gray, width, height, MAX_KEYPOINTS);
    const t1 = performance.now();
    const body = encodeRequest({ features, focal: focalSrcPx * scaleX, prior });
    const res = await fetch(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body });
    if (!res.ok) throw new Error(`VPS server: HTTP ${res.status}`);
    const out = (await res.json()) as LocalizeResponse;
    return {
      ...out,
      focalVideo: out.focal ? out.focal / scaleX : undefined,
      totalMs: performance.now() - t0,
      extractMs: t1 - t0,
      backend: extractor.backend,
      bytes: body.byteLength,
    };
  }
}
