"""Accuracy of the full pipeline on LaMAR's validation queries (phones on other days than the map).

Each query is processed as the AR app does it: grayscale, longer side 640, SuperPoint top 1024,
int8 descriptors through the wire format, a coarse prior = ground truth + beacon-like noise
(default 1.5 m mean error, as the BLE fix), a focal length guess off by up to +-15 %.

    python evaluate.py data/lamar/HGE data/maps/HGE data/db/HGE.h5 [--n 200]
"""
import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch
from lightglue import SuperPoint

from build_map import read_gray
from vps.lamar import load_session
from vps.localizer import Localizer, LocalizerConfig
from vps.mapdb import ENU_TO_AR, COLMAP_TO_THREE_CAM, MapDB, from_local
from vps.protocol import decode, encode


def yaw_three(R_three):
    """Yaw of a three.js camera (as xrAlignment.yawOf): rotation about +y of its -z axis."""
    f = R_three @ np.array([0, 0, -1.0])
    return np.arctan2(-f[0], -f[2])


def main():
    p = argparse.ArgumentParser()
    p.add_argument('capture', type=Path)
    p.add_argument('map_dir', type=Path)
    p.add_argument('db', type=Path)
    p.add_argument('--session', default='query_val_phone')
    p.add_argument('--n', type=int, default=200)
    p.add_argument('--prior-noise', type=float, default=1.2, help='per-axis sigma, m (1.2 -> 1.5 m mean error)')
    p.add_argument('--focal-noise', type=float, default=0.15)
    p.add_argument('--sensor-noise', type=float, default=12.0,
                   help='sigma of the phone heading sent along, degrees (pitch: a fifth of it); 0: none sent')
    p.add_argument('--shortlist', type=int, default=LocalizerConfig.shortlist)
    p.add_argument('--threads', type=int, default=0)
    p.add_argument('--out', type=Path)
    args = p.parse_args()
    torch.set_grad_enabled(False)

    geo = json.loads((args.map_dir / 'georef.json').read_text())
    c, s = np.cos(geo['theta']), np.sin(geo['theta'])
    G = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
    gt_t = np.array([geo['tx'], geo['ty'], 0])

    db = MapDB(args.db)
    if args.threads:
        torch.set_num_threads(args.threads)
    loc = Localizer(db, LocalizerConfig(shortlist=args.shortlist))
    sp = SuperPoint(max_num_keypoints=1024).eval()
    session = args.capture / 'sessions' / args.session
    recs = load_session(session, 'proc/alignment_trajectories.txt')
    rng = np.random.default_rng(0)
    recs = [recs[i] for i in sorted(rng.choice(len(recs), min(args.n, len(recs)), replace=False))]
    rows = []
    for r in recs:
        gray, (w0, h0), _ = read_gray(session / 'raw_data' / r.name, 640)
        h, w = (np.array(gray.shape) // 8) * 8
        import cv2
        gray = cv2.resize(gray, (int(w), int(h)), interpolation=cv2.INTER_AREA)
        sx = w / w0
        pred = sp({'image': torch.from_numpy(gray)[None, None]})
        kp = pred['keypoints'][0].numpy()
        f_gt = r.camera.params[0] * sx
        R_wc = G @ r.world_from_cam.R
        center = G @ r.world_from_cam.t + gt_t
        noisy = center[:2] + rng.normal(0, args.prior_noise, 2)
        lng, lat = from_local(noisy[0], noisy[1], *db.origin)
        level = db.levels[db.level_of_height(center[2])]['id']
        focal = f_gt * (1 + rng.uniform(-args.focal_noise, args.focal_noise))
        fwd = R_wc @ np.array([0.0, 0.0, 1.0])  # COLMAP camera z: view direction, world ENU
        sensor = None
        if args.sensor_noise:
            right, up = R_wc @ np.array([1.0, 0.0, 0.0]), -R_wc @ np.array([0.0, 1.0, 0.0])
            sensor = {'heading': float((np.degrees(np.arctan2(fwd[0], fwd[1])) + rng.normal(0, args.sensor_noise)) % 360),
                      'pitch': float(np.degrees(np.arcsin(np.clip(fwd[2], -1, 1))) + rng.normal(0, args.sensor_noise / 5)),
                      'roll': float(np.degrees(np.arctan2(right[2], up[2])) + rng.normal(0, args.sensor_noise / 5))}
        buf = encode(kp, pred['keypoint_scores'][0].numpy(), pred['descriptors'][0].numpy(), int(w), int(h), focal,
                     {'lng': float(lng), 'lat': float(lat), 'levelId': level, 'accuracy': 1.5}, sensor=sensor)
        q = decode(buf)
        t0 = time.time()
        out = loc.localize(q)
        dt = time.time() - t0
        row = {'name': r.name, 'ok': out['ok'], 'ms': dt * 1000, 'bytes': len(buf), 'prior_err': float(np.linalg.norm(noisy - center[:2]))}
        if out['ok']:
            x, y = db.to_local(out['lng'], out['lat'])
            R_three_gt = ENU_TO_AR @ R_wc @ COLMAP_TO_THREE_CAM
            from scipy.spatial.transform import Rotation
            R_three = Rotation.from_quat(out['quaternion']).as_matrix()
            dR = np.degrees(np.arccos(np.clip((np.trace(R_three.T @ R_three_gt) - 1) / 2, -1, 1)))
            dyaw = np.degrees(np.angle(np.exp(1j * (yaw_three(R_three) - yaw_three(R_three_gt)))))
            row.update(pos_err=float(np.hypot(x - center[0], y - center[1])), rot_err=float(dR), yaw_err=float(abs(dyaw)),
                       inliers=out['inliers'], level_ok=out['levelId'] == level, focal_err=out['focal'] / f_gt - 1,
                       confirmed=bool(out.get('confirmedBySensors')))
        else:
            row['reason'] = out.get('reason')
        rows.append(row)
        print(json.dumps({k: (round(v, 3) if isinstance(v, float) else v) for k, v in row.items()}))

    ok = [r for r in rows if r['ok']]
    pe = np.array([r['pos_err'] for r in ok])
    ye = np.array([r['yaw_err'] for r in ok])
    re = np.array([r['rot_err'] for r in ok])
    summary = {
        'queries': len(rows), 'localized': len(ok) / len(rows),
        'pos_err_median': float(np.median(pe)) if len(ok) else None,
        'pos_err_p90': float(np.percentile(pe, 90)) if len(ok) else None,
        'yaw_err_median': float(np.median(ye)) if len(ok) else None,
        'yaw_err_p90': float(np.percentile(ye, 90)) if len(ok) else None,
        'rot_err_median': float(np.median(re)) if len(ok) else None,
        'within_1m_5deg': float(np.mean([(r['ok'] and r['pos_err'] < 1 and r['rot_err'] < 5) for r in rows])),
        'within_0.25m_2deg': float(np.mean([(r['ok'] and r['pos_err'] < 0.25 and r['rot_err'] < 2) for r in rows])),
        'level_ok': float(np.mean([r['level_ok'] for r in ok])) if ok else None,
        'confirmed_by_sensors': sum(r['confirmed'] for r in ok),
        'confirmed_wrong': sum(r['confirmed'] and (r['pos_err'] > 2 or r['rot_err'] > 5) for r in ok),
        'wrong_poses': sum(r['pos_err'] > 2 or r['rot_err'] > 5 for r in ok),
        'server_ms_median': float(np.median([r['ms'] for r in rows])),
        'request_kib_median': float(np.median([r['bytes'] for r in rows]) / 1024),
        'prior_err_mean': float(np.mean([r['prior_err'] for r in rows])),
    }
    print(json.dumps(summary, indent=1))
    if args.out:
        args.out.write_text(json.dumps({'summary': summary, 'rows': rows}, indent=1))


if __name__ == '__main__':
    main()
