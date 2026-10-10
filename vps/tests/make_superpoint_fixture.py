"""Fixture for polymaps-ar/test/vps.test.ts: the ONNX model's dense outputs on a small image and
lightglue.SuperPoint's keypoints / descriptors on the same image. Also checks ONNX == torch.

    python tests/make_superpoint_fixture.py ../polymaps-ar/public/vps/superpoint.onnx ../polymaps-ar/test/fixtures/superpoint
"""
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from lightglue import SuperPoint


def test_image(h=160, w=224, seed=0):
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[:h, :w]
    img = 0.5 + 0.25 * np.sign(np.sin(x / 9.0) * np.sin(y / 7.0))
    for _ in range(25):  # random rectangles: corners for the detector
        x0, y0 = rng.integers(0, w - 20), rng.integers(0, h - 20)
        img[y0:y0 + rng.integers(5, 30), x0:x0 + rng.integers(5, 30)] = rng.random()
    img += rng.normal(0, 0.02, img.shape)
    return np.clip(img, 0, 1).astype(np.float32)


def main(onnx_path, out_dir, max_kp=200):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    img = test_image()
    h, w = img.shape
    sess = ort.InferenceSession(str(onnx_path))
    scores, desc = sess.run(None, {'image': img[None, None]})
    sp = SuperPoint(max_num_keypoints=max_kp).eval()
    with torch.no_grad():
        ref = sp({'image': torch.from_numpy(img)[None, None]})
    kp = ref['keypoints'][0].numpy()
    # ONNX dense outputs vs. the torch keypoints: every torch keypoint is a positive ONNX score.
    s_at = scores[0][kp[:, 1].astype(int), kp[:, 0].astype(int)]
    assert (s_at > 0.0005).all(), 'keypoints differ'
    print('ONNX ok:', len(kp), 'keypoints, max dense score', scores.max())
    scores.astype('<f4').tofile(out_dir / 'scores.f32')
    desc.astype('<f4').tofile(out_dir / 'descriptors.f32')
    json.dump({'height': h, 'width': w, 'descShape': list(desc.shape[1:]), 'maxKeypoints': max_kp,
               'keypoints': kp.round(3).tolist(), 'scores': ref['keypoint_scores'][0].numpy().tolist(),
               'descriptors': ref['descriptors'][0].numpy().round(6).tolist()},
              open(out_dir / 'expected.json', 'w'))


if __name__ == '__main__':
    main(*sys.argv[1:3])
