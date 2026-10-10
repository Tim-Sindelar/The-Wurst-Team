"""Exports the dense part of SuperPoint (LightGlue's weights) to ONNX for the browser.

The model takes a grayscale image (1, 1, H, W) in [0, 1], H and W multiples of 8, and returns
  scores       (1, H, W)          keypoint scores after non-maximum suppression (radius 4), with a
                                  4 px border set to -1, exactly as lightglue.SuperPoint computes them
  descriptors  (1, 256, H/8, W/8) L2-normalised dense descriptors
Thresholding, top-k and bilinear descriptor sampling are cheap and happen in JavaScript
(polymaps-ar/src/vps/superpoint.ts), so the output matches lightglue.SuperPoint keypoint for keypoint.

    python export_superpoint_onnx.py ../polymaps-ar/public/vps/superpoint.onnx
"""
import sys
from pathlib import Path

import torch
from lightglue import SuperPoint
from lightglue.superpoint import simple_nms


class DenseSuperPoint(torch.nn.Module):
    def __init__(self, sp: SuperPoint):
        super().__init__()
        self.sp = sp

    def forward(self, image: torch.Tensor):
        sp = self.sp
        x = sp.relu(sp.conv1a(image))
        x = sp.relu(sp.conv1b(x))
        x = sp.pool(x)
        x = sp.relu(sp.conv2a(x))
        x = sp.relu(sp.conv2b(x))
        x = sp.pool(x)
        x = sp.relu(sp.conv3a(x))
        x = sp.relu(sp.conv3b(x))
        x = sp.pool(x)
        x = sp.relu(sp.conv4a(x))
        x = sp.relu(sp.conv4b(x))
        scores = sp.convPb(sp.relu(sp.convPa(x)))
        scores = torch.nn.functional.softmax(scores, 1)[:, :-1]
        b, _, h, w = scores.shape
        scores = scores.permute(0, 2, 3, 1).reshape(b, h, w, 8, 8)
        scores = scores.permute(0, 1, 3, 2, 4).reshape(b, h * 8, w * 8)
        # simple_nms on (B, 1, H, W): ONNX MaxPool needs a 4D input.
        scores = simple_nms(scores[:, None], sp.conf.nms_radius)[:, 0]
        pad = sp.conf.remove_borders
        border = torch.zeros_like(scores, dtype=torch.bool)
        border[:, :pad] = True
        border[:, -pad:] = True
        border[:, :, :pad] = True
        border[:, :, -pad:] = True
        scores = torch.where(border, -torch.ones_like(scores), scores)
        desc = sp.convDb(sp.relu(sp.convDa(x)))
        desc = torch.nn.functional.normalize(desc, p=2, dim=1)
        return scores, desc


def main(out: Path):
    model = DenseSuperPoint(SuperPoint().eval()).eval()
    dummy = torch.rand(1, 1, 480, 640)
    out.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model, (dummy,), str(out), input_names=['image'], output_names=['scores', 'descriptors'],
        dynamic_axes={'image': {2: 'H', 3: 'W'}, 'scores': {1: 'H', 2: 'W'}, 'descriptors': {2: 'h', 3: 'w'}},
        opset_version=17, dynamo=False,
    )
    print(out, out.stat().st_size // 1024, 'KiB')


if __name__ == '__main__':
    main(Path(sys.argv[1] if len(sys.argv) > 1 else 'superpoint.onnx'))
