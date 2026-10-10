package ch.ethz.polymapsar;

import android.content.Context;
import android.os.SystemClock;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import ai.onnxruntime.providers.NNAPIFlags;

/**
 * SuperPoint on the phone's own hardware, for the page's visual fix (the WebView only has
 * single-threaded WebAssembly: ~10 s per frame). Same network (assets/superpoint.onnx, from
 * vps/export_superpoint_onnx.py) and the same post-processing as polymaps-ar/src/vps/superpoint.ts.
 *
 * Per frame size, NNAPI (the GPU / AI unit, fp16, needs fixed input shapes) and XNNPACK (all big
 * CPU cores) are both tried on the first frame; the faster one is kept, NNAPI only if its output
 * matches the CPU's.
 */
final class NativeSuperPoint {
    private static final String TAG = "SuperPoint";
    private static final float THRESHOLD = 0.0005f;
    private static final float DESC_SCALE = 256f;

    private final OrtEnvironment env = OrtEnvironment.getEnvironment();
    private final byte[] model;
    private final int threads;
    private final Map<String, OrtSession> sessions = new HashMap<>();
    private final Map<String, String> backends = new HashMap<>();

    NativeSuperPoint(Context context) throws Exception {
        try (InputStream in = context.getAssets().open("superpoint.onnx")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[1 << 16];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            model = out.toByteArray();
        }
        threads = Math.max(1, Math.min(4, Runtime.getRuntime().availableProcessors() / 2));
    }

    String backend(int width, int height) {
        String b = backends.get(width + "x" + height);
        return b == null ? "native" : b;
    }

    private OrtSession create(boolean nnapi, int width, int height) throws Exception {
        OrtSession.SessionOptions o = new OrtSession.SessionOptions();
        o.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
        // Fixed shapes: NNAPI can't run dynamic ones (and XNNPACK plans better with them).
        o.setSymbolicDimensionValue("H", height);
        o.setSymbolicDimensionValue("W", width);
        if (nnapi) {
            o.addNnapi(EnumSet.of(NNAPIFlags.USE_FP16));
        } else {
            Map<String, String> x = new HashMap<>();
            x.put("intra_op_num_threads", Integer.toString(threads));
            o.addXnnpack(x);
            o.setIntraOpNumThreads(1);
        }
        return env.createSession(model, o);
    }

    private static final class Dense {
        float[] scores;
        float[] desc;
        int c, h, w;
        long ms;
    }

    private Dense infer(OrtSession s, float[] gray, int width, int height) throws Exception {
        long t0 = SystemClock.elapsedRealtime();
        try (OnnxTensor input = OnnxTensor.createTensor(env, FloatBuffer.wrap(gray), new long[]{1, 1, height, width});
             OrtSession.Result r = s.run(Collections.singletonMap("image", input))) {
            Dense d = new Dense();
            OnnxTensor scores = (OnnxTensor) r.get("scores").get();
            OnnxTensor desc = (OnnxTensor) r.get("descriptors").get();
            d.scores = new float[height * width];
            scores.getFloatBuffer().get(d.scores);
            long[] shape = desc.getInfo().getShape();
            d.c = (int) shape[1];
            d.h = (int) shape[2];
            d.w = (int) shape[3];
            d.desc = new float[d.c * d.h * d.w];
            desc.getFloatBuffer().get(d.desc);
            d.ms = SystemClock.elapsedRealtime() - t0;
            return d;
        }
    }

    /**
     * Grayscale bytes (row-major) -> packed result, little-endian:
     * i32 n | f32 keypoints (n x 2) | f32 scores (n) | i8 descriptors (n x 256, round(d * 256)).
     */
    synchronized byte[] extract(byte[] grayBytes, int width, int height, int maxKeypoints) throws Exception {
        float[] gray = new float[width * height];
        for (int i = 0; i < gray.length; i++) gray[i] = (grayBytes[i] & 0xff) / 255f;
        String key = width + "x" + height;
        Dense d;
        OrtSession s = sessions.get(key);
        if (s != null) {
            d = infer(s, gray, width, height);
        } else {
            OrtSession cpu = create(false, width, height);
            infer(cpu, gray, width, height); // warm-up: the first run plans memory
            Dense dc = infer(cpu, gray, width, height);
            d = dc;
            s = cpu;
            String backend = "xnnpack x" + threads;
            try {
                OrtSession nn = create(true, width, height);
                infer(nn, gray, width, height);
                Dense dn = infer(nn, gray, width, height);
                boolean same = agree(dc, dn, height, width, maxKeypoints);
                Log.i(TAG, key + ": xnnpack " + dc.ms + " ms, nnapi " + dn.ms + " ms, outputs agree: " + same);
                if (same && dn.ms < dc.ms * 0.8) {
                    cpu.close();
                    s = nn;
                    d = dn;
                    backend = "nnapi";
                } else {
                    nn.close();
                }
            } catch (Exception e) {
                Log.w(TAG, "NNAPI unavailable", e);
            }
            sessions.put(key, s);
            backends.put(key, backend);
        }
        return pack(d, height, width, maxKeypoints);
    }

    /** NNAPI in fp16 must find nearly the same keypoints and descriptors as the CPU. */
    private boolean agree(Dense a, Dense b, int height, int width, int maxKeypoints) {
        int[] ka = select(a.scores, height, width, maxKeypoints);
        int[] kb = select(b.scores, height, width, maxKeypoints);
        if (ka.length == 0) return false;
        java.util.HashSet<Integer> set = new java.util.HashSet<>();
        for (int i : ka) set.add(i);
        int common = 0;
        for (int i : kb) if (set.contains(i)) common++;
        if (common < 0.8 * ka.length) return false;
        float[] da = sample(a, ka, width), db = sample(b, ka, width);
        double dot = 0;
        for (int i = 0; i < da.length; i++) dot += da[i] * db[i];
        return dot / ka.length > 0.98;
    }

    /** Pixel indices above the threshold, best first (ties by raster order), at most k. */
    private static int[] select(float[] scores, int height, int width, int k) {
        List<Integer> idx = new ArrayList<>();
        for (int i = 0; i < height * width; i++) if (scores[i] > THRESHOLD) idx.add(i);
        idx.sort((x, y) -> scores[x] != scores[y] ? Float.compare(scores[y], scores[x]) : Integer.compare(x, y));
        int n = Math.min(k, idx.size());
        int[] out = new int[n];
        for (int i = 0; i < n; i++) out[i] = idx.get(i);
        return out;
    }

    /** Bilinear descriptor sampling as lightglue's sample_descriptors (align_corners=True, s = 8), normalised. */
    private static float[] sample(Dense d, int[] kp, int width) {
        final int s = 8, c = d.c, h = d.h, w = d.w, plane = h * w;
        float sx = (w - 1f) / (w * s - s / 2f - 0.5f), sy = (h - 1f) / (h * s - s / 2f - 0.5f);
        float[] out = new float[kp.length * c];
        for (int k = 0; k < kp.length; k++) {
            float x = (kp[k] % width - s / 2f + 0.5f) * sx;
            float y = (kp[k] / width - s / 2f + 0.5f) * sy;
            int x0 = (int) Math.floor(x), y0 = (int) Math.floor(y);
            float fx = x - x0, fy = y - y0;
            int[][] taps = {{x0, y0}, {x0 + 1, y0}, {x0, y0 + 1}, {x0 + 1, y0 + 1}};
            float[] wts = {(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy};
            int base = k * c;
            for (int t = 0; t < 4; t++) {
                int tx = taps[t][0], ty = taps[t][1];
                if (wts[t] == 0 || tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
                int o = ty * w + tx;
                for (int ch = 0; ch < c; ch++) out[base + ch] += wts[t] * d.desc[ch * plane + o];
            }
            double norm = 0;
            for (int ch = 0; ch < c; ch++) norm += out[base + ch] * out[base + ch];
            float inv = (float) (1 / Math.max(Math.sqrt(norm), 1e-12));
            for (int ch = 0; ch < c; ch++) out[base + ch] *= inv;
        }
        return out;
    }

    private static byte[] pack(Dense d, int height, int width, int maxKeypoints) {
        int[] kp = select(d.scores, height, width, maxKeypoints);
        float[] desc = sample(d, kp, width);
        int n = kp.length;
        ByteBuffer b = ByteBuffer.allocate(4 + n * 12 + n * d.c).order(ByteOrder.LITTLE_ENDIAN);
        b.putInt(n);
        for (int i : kp) b.putFloat(i % width).putFloat(i / width);
        for (int i : kp) b.putFloat(d.scores[i]);
        for (float v : desc) b.put((byte) Math.max(-127, Math.min(127, Math.round(v * DESC_SCALE))));
        return b.array();
    }
}
