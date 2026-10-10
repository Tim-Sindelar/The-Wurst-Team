/** Web Worker running SuperPoint (see SuperPointExtractor in superpoint.ts). */
import { SuperPointRunner } from './superpoint';

let runner: Promise<SuperPointRunner> | null = null;

self.onmessage = async (e: MessageEvent) => {
  const { id, type } = e.data;
  try {
    if (type === 'init') {
      runner ??= SuperPointRunner.create(e.data.modelUrl, e.data.forceWasm);
      self.postMessage({ id, ok: true, result: (await runner).backend });
    } else if (type === 'extract') {
      if (!runner) throw new Error('not initialised');
      const f = await (await runner).extract(e.data.gray, e.data.width, e.data.height, e.data.maxKeypoints);
      self.postMessage({ id, ok: true, result: f }, { transfer: [f.keypoints.buffer, f.scores.buffer, f.descriptors.buffer] });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
