import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Quaternion, Vector3 } from 'three';
import { sampleDescriptors, selectKeypoints } from '../src/vps/superpoint';
import { DESC_SCALE, encodeRequest } from '../src/vps/protocol';
import { focalFromFov, fovFromFocal } from '../src/vps/client';
import { headingCorrection } from '../src/vps/fusion';
import { yawOf } from '../src/ar/xrAlignment';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/superpoint/${name}`, import.meta.url));
const f32 = (name: string) => {
  const b = readFileSync(fixture(name));
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};

describe('SuperPoint post-processing', () => {
  // Dense outputs of public/vps/superpoint.onnx and lightglue.SuperPoint's result on the same image
  // (vps/tests/make_superpoint_fixture.py): the browser must produce the server's features.
  const expected = JSON.parse(readFileSync(fixture('expected.json'), 'utf8')) as {
    height: number; width: number; descShape: [number, number, number]; maxKeypoints: number;
    keypoints: [number, number][]; scores: number[]; descriptors: number[][];
  };
  const { keypoints, scores } = selectKeypoints(f32('scores.f32'), expected.height, expected.width, expected.maxKeypoints);

  it('selects the same keypoints as lightglue', () => {
    const ours = new Set<string>();
    for (let i = 0; i < scores.length; i++) ours.add(`${keypoints[2 * i]},${keypoints[2 * i + 1]}`);
    const theirs = new Set(expected.keypoints.map(([x, y]) => `${x},${y}`));
    expect(scores.length).toBe(expected.keypoints.length);
    const common = [...ours].filter((k) => theirs.has(k)).length;
    // Ties at the k-th score may be broken differently.
    expect(common / theirs.size).toBeGreaterThan(0.98);
  });

  it('samples the same descriptors', () => {
    const [c, h, w] = expected.descShape;
    const kp = new Float32Array(expected.keypoints.flat());
    const desc = sampleDescriptors(f32('descriptors.f32'), c, h, w, kp);
    let worst = 1;
    for (let i = 0; i < expected.keypoints.length; i++) {
      let dot = 0;
      for (let ch = 0; ch < c; ch++) dot += desc[i * c + ch] * expected.descriptors[i][ch];
      worst = Math.min(worst, dot);
    }
    expect(worst).toBeGreaterThan(0.9999);
  });

  it('keeps descriptors within the int8 wire range', () => {
    const [c, h, w] = expected.descShape;
    const desc = sampleDescriptors(f32('descriptors.f32'), c, h, w, new Float32Array(expected.keypoints.flat()));
    const clipped = desc.filter((v) => Math.abs(v * DESC_SCALE) > 127).length;
    expect(clipped / desc.length).toBeLessThan(0.001);
  });
});

describe('VPS protocol', () => {
  it('encodes header, keypoints, scores and int8 descriptors', () => {
    const n = 3;
    const descriptors = new Float32Array(n * 256).fill(0.0625);
    const buf = encodeRequest({
      features: { width: 640, height: 480, keypoints: new Float32Array([1, 2, 3, 4, 5, 6]), scores: new Float32Array([0.5, 0.25, 0.125]), descriptors },
      focal: 500,
      prior: { lng: 8.5, lat: 47.3, levelId: 'ETH.HG.E', accuracy: 2 },
    });
    const view = new DataView(buf);
    expect(new TextDecoder().decode(new Uint8Array(buf, 0, 4))).toBe('VPS1');
    const hlen = view.getUint32(4, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hlen)));
    expect(header).toMatchObject({ n, width: 640, height: 480, focal: 500, descScale: DESC_SCALE });
    expect(buf.byteLength).toBe(8 + hlen + n * 8 + n * 4 + n * 256);
    expect(view.getFloat32(8 + hlen + 4 * 3, true)).toBe(4);
    expect(new Int8Array(buf, 8 + hlen + n * 12, 1)[0]).toBe(16);
  });
});

describe('camera geometry', () => {
  it('converts between overlay FOV and video focal length under object-fit: cover', () => {
    // Portrait phone view, landscape-shaped 4:3 video stream rotated to portrait (1440 x 1920).
    const f = focalFromFov(60, 1440, 1920, 390, 800);
    expect(fovFromFocal(f, 1440, 1920, 390, 800)).toBeCloseTo(60, 6);
    // Video exactly filling the view: focal = (h/2) / tan(fov/2).
    expect(focalFromFov(60, 1000, 2000, 500, 1000)).toBeCloseTo(1000 / Math.tan(Math.PI / 6), 6);
  });

  it('heading correction turns the rendered camera onto the visual one', () => {
    const up = new Vector3(0, 1, 0);
    const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.3);
    const rendered = new Quaternion().setFromAxisAngle(up, 0.4).multiply(tilt);
    const visual = new Quaternion().setFromAxisAngle(up, -0.5).multiply(tilt);
    const d = headingCorrection(rendered, visual);
    expect(d).toBeCloseTo((-0.9 * 180) / Math.PI, 4);
    const corrected = new Quaternion().setFromAxisAngle(up, (d * Math.PI) / 180).multiply(rendered);
    expect(yawOf(corrected)).toBeCloseTo(yawOf(visual), 6);
  });
});
