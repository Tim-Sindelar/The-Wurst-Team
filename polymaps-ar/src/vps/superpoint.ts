/**
 * SuperPoint keypoints and descriptors in the browser.
 *
 * The network (public/vps/superpoint.onnx, from vps/export_superpoint_onnx.py) returns the dense
 * score map after non-maximum suppression and the dense descriptor map; this file does the rest of
 * lightglue.SuperPoint: threshold, top-k by score, bilinear descriptor sampling, L2 normalisation.
 * The server matches these against a map extracted with lightglue.SuperPoint, so both sides must
 * agree on every detail (see test/vps.test.ts).
 */
import type { InferenceSession, Tensor } from 'onnxruntime-web';

export const DESCRIPTOR_DIM = 256;
export const DETECTION_THRESHOLD = 0.0005;

export interface Features {
  /** Image size the keypoints refer to. */
  width: number;
  height: number;
  /** [x0, y0, x1, y1, ...] pixel coordinates (pixel centres at integers, as lightglue). */
  keypoints: Float32Array;
  scores: Float32Array;
  /** N x 256, row-major, unit length rows. */
  descriptors: Float32Array;
}

/** Keypoints above the threshold, the `maxKeypoints` best first (ties by raster order). */
export function selectKeypoints(scores: Float32Array, height: number, width: number, maxKeypoints: number, threshold = DETECTION_THRESHOLD) {
  const idx: number[] = [];
  for (let i = 0; i < height * width; i++) if (scores[i] > threshold) idx.push(i);
  idx.sort((a, b) => scores[b] - scores[a] || a - b);
  const n = Math.min(maxKeypoints, idx.length);
  const keypoints = new Float32Array(2 * n);
  const kpScores = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const i = idx[k];
    keypoints[2 * k] = i % width;
    keypoints[2 * k + 1] = Math.floor(i / width);
    kpScores[k] = scores[i];
  }
  return { keypoints, scores: kpScores };
}

/**
 * Bilinear sampling of a (C, h, w) descriptor map at keypoints, as lightglue's sample_descriptors
 * (grid_sample with align_corners=True on coordinates mapped by the cell size s = 8, zero padding).
 */
export function sampleDescriptors(dense: Float32Array, c: number, h: number, w: number, keypoints: Float32Array, s = 8): Float32Array {
  const n = keypoints.length / 2;
  const out = new Float32Array(n * c);
  const sx = (w - 1) / (w * s - s / 2 - 0.5);
  const sy = (h - 1) / (h * s - s / 2 - 0.5);
  const plane = h * w;
  for (let k = 0; k < n; k++) {
    // Normalised to [-1, 1] then to descriptor-grid pixels (align_corners=True).
    const x = (keypoints[2 * k] - s / 2 + 0.5) * sx;
    const y = (keypoints[2 * k + 1] - s / 2 + 0.5) * sy;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const taps: [number, number, number][] = [
      [x0, y0, (1 - fx) * (1 - fy)],
      [x0 + 1, y0, fx * (1 - fy)],
      [x0, y0 + 1, (1 - fx) * fy],
      [x0 + 1, y0 + 1, fx * fy],
    ];
    const row = out.subarray(k * c, (k + 1) * c);
    for (const [tx, ty, wt] of taps) {
      if (wt === 0 || tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      const o = ty * w + tx;
      for (let ch = 0; ch < c; ch++) row[ch] += wt * dense[ch * plane + o];
    }
    let norm = 0;
    for (let ch = 0; ch < c; ch++) norm += row[ch] * row[ch];
    norm = Math.max(Math.sqrt(norm), 1e-12);
    for (let ch = 0; ch < c; ch++) row[ch] /= norm;
  }
  return out;
}

/**
 * Grayscale (as kornia's rgb_to_grayscale) of an RGBA image, resized so its longer side is
 * `maxSide` and both sides are multiples of 8 (SuperPoint's cell size).
 */
export function toGray(source: CanvasImageSource, srcWidth: number, srcHeight: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(srcWidth, srcHeight));
  const width = Math.max(8, Math.round((srcWidth * scale) / 8) * 8);
  const height = Math.max(8, Math.round((srcHeight * scale) / 8) * 8);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, width, height);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = (0.299 * rgba[4 * i] + 0.587 * rgba[4 * i + 1] + 0.114 * rgba[4 * i + 2]) / 255;
  return { gray, width, height, scaleX: width / srcWidth, scaleY: height / srcHeight };
}

type Ort = typeof import('onnxruntime-web');

/** WebGPU only where the device really has an adapter (many WebViews expose navigator.gpu without one). */
async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

/**
 * The network in the current thread (normally inside superpointWorker.ts). The backend is chosen
 * once, before onnxruntime initialises its WASM runtime: that can only be initialised once per
 * thread, so a failed attempt can't be retried with another backend.
 */
export class SuperPointRunner {
  private constructor(private readonly ort: Ort, private readonly session: InferenceSession, readonly backend: string) {}

  /** `modelUrl` absolute (a worker resolves relative URLs against its script, not the page). */
  static async create(modelUrl: string, forceWasm = false): Promise<SuperPointRunner> {
    const ort = await import('onnxruntime-web');
    ort.env.wasm.proxy = false;
    // Threads need SharedArrayBuffer, i.e. a cross-origin isolated page.
    ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    const providers = !forceWasm && (await hasWebGpu()) ? ['webgpu', 'wasm'] : ['wasm'];
    const session = await ort.InferenceSession.create(modelUrl, { executionProviders: providers, graphOptimizationLevel: 'all' });
    return new SuperPointRunner(ort, session, providers[0]);
  }

  async extract(gray: Float32Array, width: number, height: number, maxKeypoints: number): Promise<Features> {
    const input = new this.ort.Tensor('float32', gray, [1, 1, height, width]);
    const out = await this.session.run({ image: input });
    const scores = (await (out.scores as Tensor).getData()) as Float32Array;
    const descT = out.descriptors as Tensor;
    const dense = (await descT.getData()) as Float32Array;
    const [, c, h, w] = descT.dims as number[];
    const kp = selectKeypoints(scores, height, width, maxKeypoints);
    const descriptors = sampleDescriptors(dense, c, h, w, kp.keypoints);
    for (const t of Object.values(out)) (t as Tensor).dispose?.();
    return { width, height, keypoints: kp.keypoints, scores: kp.scores, descriptors };
  }
}

/** ?vpsBackend=wasm: skip WebGPU (testing the path most phone WebViews take). */
const FORCE_WASM = typeof location !== 'undefined' && new URLSearchParams(location.search).get('vpsBackend') === 'wasm';

type Reply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/**
 * SuperPoint for the page: runs in a Web Worker so the AR view keeps rendering while a frame is
 * processed (1-3 s on a phone). Falls back to the page's thread if a worker can't be started.
 */
export class SuperPointExtractor {
  private constructor(
    private readonly worker: Worker | null,
    private readonly local: SuperPointRunner | null,
    readonly backend: string,
  ) {}

  private static pending = new Map<number, (r: Reply) => void>();
  private static nextId = 1;

  private static call(worker: Worker, msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<unknown> {
    const id = SuperPointExtractor.nextId++;
    return new Promise((resolve, reject) => {
      SuperPointExtractor.pending.set(id, (r) => (r.ok ? resolve(r.result) : reject(new Error(r.error))));
      worker.postMessage({ ...msg, id }, transfer);
    });
  }

  /** `modelUrl` relative to the page. */
  static async load(modelUrl: string): Promise<SuperPointExtractor> {
    const url = new URL(modelUrl, document.baseURI).href;
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('./superpointWorker.ts', import.meta.url), { type: 'module' });
    } catch (e) {
      console.warn('SuperPoint worker unavailable, running on the page', e);
    }
    if (worker) {
      worker.onmessage = (e: MessageEvent<Reply>) => {
        SuperPointExtractor.pending.get(e.data.id)?.(e.data);
        SuperPointExtractor.pending.delete(e.data.id);
      };
      try {
        const backend = (await SuperPointExtractor.call(worker, { type: 'init', modelUrl: url, forceWasm: FORCE_WASM })) as string;
        return new SuperPointExtractor(worker, null, backend);
      } catch (e) {
        worker.terminate();
        // The worker's own WASM init failed: the page's thread has a fresh one to try.
        console.warn('SuperPoint worker failed, running on the page', e);
      }
    }
    const local = await SuperPointRunner.create(url, FORCE_WASM);
    return new SuperPointExtractor(null, local, local.backend);
  }

  async extract(gray: Float32Array, width: number, height: number, maxKeypoints: number): Promise<Features> {
    if (this.local) return this.local.extract(gray, width, height, maxKeypoints);
    return (await SuperPointExtractor.call(this.worker!, { type: 'extract', gray, width, height, maxKeypoints }, [gray.buffer])) as Features;
  }
}
