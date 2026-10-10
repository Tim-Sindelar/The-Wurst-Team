/**
 * Visual positioning: SuperPoint features of a camera frame, computed on the phone, are sent to the
 * VPS server (vps/), which matches them against a 3D map built from the LaMAR dataset (ETH HG and
 * CAB) and returns the camera's position and full orientation. The image itself never leaves the
 * phone (except in debug mode, debug.ts); a request is ~260 KiB for 1024 keypoints.
 */
import { NativeSuperPointExtractor, SuperPointExtractor, toGray, type Features } from './superpoint';
import { encodeRequest, type LocalizeRequest, type LocalizeResponse } from './protocol';

/** Longer side of the image the features are computed on. */
export const FEATURE_MAX_SIDE = 640;
export const MAX_KEYPOINTS = 1024;
/** ?vpsBackend=wasm|webgpu: the browser's ONNX Runtime even in the Android app (comparison). */
const FORCE_WEB = typeof location !== 'undefined' && /^(wasm|webgpu)$/.test(new URLSearchParams(location.search).get('vpsBackend') ?? '');

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
  /** Debug mode: what SuperPoint ran on and found (for the debug panel and the upload). */
  frame?: DebugFrame;
}

export interface DebugFrame {
  /** The network's input, 0..1, row-major. */
  gray: Float32Array;
  width: number;
  height: number;
  /** Feature image pixels per source (video) pixel. */
  scaleX: number;
  scaleY: number;
  features: Features;
  /** Focal length guess sent, feature image pixels. */
  focal: number;
}

export class VpsClient {
  private extractor: Promise<SuperPointExtractor | NativeSuperPointExtractor> | null = null;

  constructor(
    /** Relative to the page: the model is served with the app, the endpoint by the VPS server. */
    private readonly modelUrl = 'vps/superpoint.onnx',
    private readonly endpoint = 'vps/localize',
  ) {}

  /** Loads the network (~5 MB, cached by the browser). */
  load(): Promise<SuperPointExtractor | NativeSuperPointExtractor> {
    if (!this.extractor) {
      // In the Android app: the phone's own ONNX Runtime (NNAPI / all CPU cores), ~10x the WebView's WASM.
      this.extractor = NativeSuperPointExtractor.available() && !FORCE_WEB
        ? Promise.resolve(new NativeSuperPointExtractor())
        : SuperPointExtractor.load(this.modelUrl);
      this.extractor.catch(() => (this.extractor = null));
    }
    return this.extractor;
  }

  /**
   * Localizes one frame. The frame is read synchronously when this is called, so the caller can
   * snapshot its own orientation estimate right before or after for the same instant.
   */
  async localize(
    source: CanvasImageSource, srcW: number, srcH: number, focalSrcPx: number, prior: LocalizeRequest['prior'],
    opts: {
      /** Debug mode: the server answers with its intermediate results and keeps the query under this id. */
      debugId?: string;
      sensor?: LocalizeRequest['sensor'];
    } = {},
  ): Promise<VpsResult> {
    const { debugId, sensor } = opts;
    const t0 = performance.now();
    const { gray, width, height, scaleX, scaleY } = toGray(source, srcW, srcH, FEATURE_MAX_SIDE);
    const kept = debugId ? gray.slice() : null; // the worker takes `gray` over
    const extractor = await this.load();
    const features: Features = await extractor.extract(gray, width, height, MAX_KEYPOINTS);
    const t1 = performance.now();
    // A view without size (hidden) gives no FOV: assume 60 deg vertically.
    const focal = Number.isFinite(focalSrcPx) && focalSrcPx > 0 ? focalSrcPx * scaleX : height / 2 / Math.tan(Math.PI / 6);
    const body = encodeRequest({ features, focal, prior, debug: debugId, sensor });
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
      frame: kept ? { gray: kept, width, height, scaleX, scaleY, features, focal } : undefined,
    };
  }
}
