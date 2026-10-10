"""Looks at debug bundles from the AR app's debug mode (see vps/debugstore.py).

    scp -r viscon-vm:~/vps/debug data/          # fetch them from the VM
    python debug_replay.py data/debug --summary # one line per bundle
    python debug_replay.py data/debug/<id> --db data/db/*.h5 [--images data/lamar/HGE/sessions/map/raw_data]

For one bundle it
  1. re-runs the localizer on the phone's features (same answer as on the phone? config changes);
  2. extracts SuperPoint on the uploaded frame with the reference PyTorch model and compares it with
     the phone's features (an on-device extraction problem: NNAPI precision, wrong image layout,
     rotated frame...), then localizes with those features too;
  3. draws <bundle>/replay.png: the frame with all / matched / inlier keypoints and where the pose
     reprojects the inliers' 3D points, a top view (floor plan, map cameras near the beacon fix, the
     shortlist, beacon fix, visual pose and both headings) and the shortlisted map images.
"""
import argparse
import json
import math
from pathlib import Path

import cv2
import numpy as np
import torch

from vps.localizer import Localizer, LocalizerConfig
from vps.mapdb import MapSet
from vps.protocol import decode, encode


def load(bundle: Path) -> dict:
    b = {'dir': bundle, 'id': bundle.name}
    for name in ('server', 'client'):
        p = bundle / f'{name}.json'
        b[name] = json.loads(p.read_text()) if p.exists() else {}
    return b


def summary(root: Path):
    rows = []
    for d in sorted((p for p in root.iterdir() if (p / 'server.json').exists()), key=lambda p: p.stat().st_mtime):
        b = load(d)
        s, c = b['server'], b['client']
        dbg = s.get('debug', {})
        o, img = c.get('orientation', {}), c.get('image', {})
        dh = None
        if s.get('ok') and o.get('heading') is not None:
            dh = (s['heading'] - o['heading'] + 180) % 360 - 180
        rows.append([
            d.name[:20], s.get('receivedAt', '')[5:19], 'ok' if s.get('ok') else (s.get('reason') or '?')[:28],
            dbg.get('keypoints', ''), len(dbg.get('candidates', [])), s.get('matches', ''), s.get('inliers', ''),
            '' if dh is None else f'{dh:+.0f}', c.get('backend', ''), c.get('timing', {}).get('extractMs', ''),
            img.get('mean', ''), img.get('sharpness', ''), o.get('angularSpeed', ''), 'png' if (d / 'frame.png').exists() else '-',
        ])
    head = ['id', 'received', 'result', 'kp', 'cands', 'matches', 'inliers', 'dHead', 'backend', 'extractMs',
            'bright', 'sharp', 'deg/s', 'frame']
    widths = [max(len(str(r[i])) for r in rows + [head]) for i in range(len(head))]
    for r in [head] + rows:
        print('  '.join(str(v).ljust(w) for v, w in zip(r, widths)))


def compare_features(q, sp, gray: np.ndarray) -> tuple[dict, dict]:
    """Reference SuperPoint on the frame vs. the phone's keypoints and descriptors."""
    pred = sp({'image': torch.from_numpy(gray)[None, None]})
    kp = pred['keypoints'][0].numpy()
    desc = pred['descriptors'][0].numpy()
    scores = pred['keypoint_scores'][0].numpy()
    out = {'phone': len(q.keypoints), 'reference': len(kp)}
    if len(kp) and len(q.keypoints):
        d = np.linalg.norm(q.keypoints[:, None] - kp[None], axis=2)
        j = d.argmin(1)
        same = d[np.arange(len(j)), j] < 1.0
        out['sameKeypoints'] = round(float(same.mean()), 3)
        if same.any():
            cos = np.sum(q.descriptors[same] * desc[j[same]], 1)
            out['descriptorCos'] = {'median': round(float(np.median(cos)), 4), 'min': round(float(cos.min()), 4)}
    return out, {'kp': kp, 'scores': scores, 'desc': desc}


def draw_frame(gray: np.ndarray | None, q, dbg: dict) -> np.ndarray:
    if gray is None:
        img = np.full((q.height, q.width, 3), 40, np.uint8)
    else:
        img = cv2.cvtColor((gray * 255).astype(np.uint8), cv2.COLOR_GRAY2BGR)
    for x, y in q.keypoints:
        cv2.circle(img, (int(x), int(y)), 1, (160, 160, 160), -1)
    for k in dbg.get('matchedKp', []):
        x, y = q.keypoints[k]
        cv2.circle(img, (int(x), int(y)), 3, (0, 140, 255), 1)
    for k, (u, v) in zip(dbg.get('inlierKp', []), dbg.get('reprojected', [])):
        x, y = q.keypoints[k]
        cv2.line(img, (int(x), int(y)), (int(u), int(v)), (255, 120, 0), 1)
        cv2.circle(img, (int(x), int(y)), 3, (0, 220, 0), -1)
    return img


def draw_top(db, dbg: dict, out: dict, client: dict, size: int = 520) -> np.ndarray:
    """Top view around the beacon fix: 1 px = 5 cm, north up."""
    img = np.full((size, size, 3), 255, np.uint8)
    prior = dbg.get('prior')
    if not prior:
        return img
    res = 0.05
    cx, cy = prior['x'], prior['y']

    def px(x, y):
        return int(size / 2 + (x - cx) / res), int(size / 2 - (y - cy) / res)

    try:  # floor plan walls (needs the repo's occupancy-map-preview floors)
        from georeference import load_level
        level = load_level(prior['levelId'], db.origin)
        for line in level['rings'] + level['walls']:
            cv2.polylines(img, [np.array([px(x, y) for x, y in line], np.int32)], False, (190, 190, 190), 1)
    except Exception:
        pass
    cv2.circle(img, px(cx, cy), int(prior['radius'] / res), (230, 230, 230), 1)
    names = {n: i for i, n in enumerate(db.names)}
    for c in dbg.get('candidates', []):
        i = names.get(c['name'])
        if i is not None:
            cv2.circle(img, px(*db.centers[i, :2]), 2, (200, 160, 120), -1)
    for k, s in enumerate(dbg.get('shortlist', [])):
        p = px(*s['center'][:2])
        cv2.circle(img, p, 5, (255, 0, 0) if s.get('used') else (200, 200, 255), 2)
        cv2.putText(img, str(k + 1), (p[0] + 6, p[1] - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 0, 0), 1)

    def arrow(x, y, heading, color, length=1.5):
        h = math.radians(heading)
        cv2.arrowedLine(img, px(x, y), px(x + length * math.sin(h), y + length * math.cos(h)), color, 2, tipLength=0.25)

    cv2.drawMarker(img, px(cx, cy), (0, 0, 220), cv2.MARKER_CROSS, 14, 2)
    o = client.get('orientation', {})
    if o.get('heading') is not None:
        arrow(cx, cy, o['heading'], (0, 0, 220))  # the phone's heading at capture, at the beacon fix
    pose = dbg.get('pose')
    if pose:
        x, y = db.to_local(pose['lng'], pose['lat'])
        arrow(float(x), float(y), pose['heading'], (0, 170, 0) if out.get('ok') else (0, 120, 255))
    cv2.putText(img, 'red: beacon fix + phone heading, green: visual pose (orange: rejected), blue: shortlist',
                (6, size - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 0), 1)
    return img


def shortlist_images(dbg: dict, roots: list[Path], h: int = 240) -> np.ndarray | None:
    tiles = []
    for k, s in enumerate(dbg.get('shortlist', [])):
        for r in roots:
            p = r / s['name']
            if p.exists():
                im = cv2.imread(str(p))
                im = cv2.resize(im, (int(im.shape[1] * h / im.shape[0]), h))
                label = f"{k + 1}: mnn {s['mnn']} lg {s.get('matches', '-')} 3d {s.get('matches3d', '-')}"
                cv2.putText(im, label, (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)
                tiles.append(im)
                break
    return np.concatenate(tiles, 1) if tiles else None


def stack(rows: list[np.ndarray]) -> np.ndarray:
    w = max(r.shape[1] for r in rows)
    return np.concatenate([np.pad(r, ((0, 0), (0, w - r.shape[1]), (0, 0)), constant_values=255) for r in rows], 0)


def replay(bundle: Path, maps: MapSet, image_roots: list[Path], sp):
    b = load(bundle)
    q = decode((bundle / 'request.bin').read_bytes())
    db = maps.pick(q.prior)
    print(f'{bundle.name}: {len(q.keypoints)} keypoints, {q.width}x{q.height}, focal guess {q.focal:.0f}, prior {q.prior}')
    phone = {k: b['server'].get(k) for k in ('ok', 'reason', 'inliers', 'heading')}
    print('  on the phone:', phone, '| client:', {k: b['client'].get(k) for k in ('backend', 'timing', 'image')})
    if db is None:
        print('  outside the mapped area')
        return
    loc = Localizer(db, LocalizerConfig())
    out = loc.localize(q, debug=True)
    dbg = out['debug']
    print('  replay:', {k: out.get(k) for k in ('ok', 'reason', 'matches', 'inliers', 'heading', 'ms')})
    print('  shortlist:', [(s['mnn'], s.get('matches'), s.get('matches3d')) for s in dbg.get('shortlist', [])],
          '| solvers:', dbg.get('solvers'), '| reprojection px:', dbg.get('reprojError'), '| depth m:', dbg.get('inlierDepth'))
    if dbg.get('pose'):
        print('  pose:', {k: dbg['pose'][k] for k in ('heading', 'pitch', 'height', 'priorDist', 'focal')})
    gray = None
    if (bundle / 'frame.png').exists():
        gray = cv2.imread(str(bundle / 'frame.png'), cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
        if gray.shape != (q.height, q.width):
            print(f'  frame.png is {gray.shape[1]}x{gray.shape[0]}, features are for {q.width}x{q.height}!')
        else:
            cmp, ref = compare_features(q, sp, gray)
            print('  reference SuperPoint vs phone:', cmp)
            buf = encode(ref['kp'], ref['scores'], ref['desc'], q.width, q.height, q.focal, q.prior)
            out_ref = loc.localize(decode(buf))
            print('  localized with reference features:', {k: out_ref.get(k) for k in ('ok', 'reason', 'matches', 'inliers', 'heading')})
    rows = [np.concatenate([draw_frame(gray, q, dbg), draw_top(db, dbg, out, b['client'], max(q.height, 320))], 1)]
    thumbs = shortlist_images(dbg, image_roots)
    if thumbs is not None:
        rows.append(thumbs)
    cv2.imwrite(str(bundle / 'replay.png'), stack(rows))
    (bundle / 'replay.json').write_text(json.dumps(out, indent=1))
    print('  ->', bundle / 'replay.png')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('bundles', nargs='+', type=Path, help='bundle directories, or the debug root with --summary')
    p.add_argument('--summary', action='store_true')
    p.add_argument('--db', nargs='+', type=Path)
    p.add_argument('--images', nargs='*', type=Path, default=[], help="map images' roots (LaMAR sessions/map/raw_data)")
    args = p.parse_args()
    if args.summary:
        for root in args.bundles:
            summary(root)
        return
    if not args.db:
        p.error('--db is needed to replay')
    torch.set_grad_enabled(False)
    from lightglue import SuperPoint
    sp = SuperPoint(max_num_keypoints=1024).eval()
    maps = MapSet(args.db)
    for bundle in args.bundles:
        replay(bundle, maps, args.images, sp)


if __name__ == '__main__':
    main()
