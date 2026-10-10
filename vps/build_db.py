"""Packs a triangulated, georeferenced map into the database the server reads (see vps/mapdb.py).

Only triangulated keypoints are kept (the others can't give 2D-3D matches), descriptors as float16,
everything moved into the georeferenced frame (x east, y north, z up, metres from the origin).

    python build_db.py data/maps/HGE data/db/HGE.h5 --scene HGE
"""
import argparse
import json
from pathlib import Path

import h5py
import numpy as np
import pycolmap
from tqdm import tqdm


def main():
    p = argparse.ArgumentParser()
    p.add_argument('map_dir', type=Path)
    p.add_argument('out', type=Path)
    p.add_argument('--scene', required=True)
    p.add_argument('--min-points', type=int, default=40)
    args = p.parse_args()

    rec = pycolmap.Reconstruction(args.map_dir / 'sfm')
    geo = json.loads((args.map_dir / 'georef.json').read_text())
    c, s = np.cos(geo['theta']), np.sin(geo['theta'])
    R2 = np.array([[c, -s], [s, c]])
    R3 = np.eye(3)
    R3[:2, :2] = R2
    t3 = np.array([geo['tx'], geo['ty'], 0.0])

    def to_world(xyz):
        return xyz @ R3.T + t3

    level_z = np.array([lv['cameraZ'] for lv in geo['levels']])
    point_ids = {}
    names, centers, sizes, image_level = [], [], [], []
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with h5py.File(args.map_dir / 'features.h5', 'r') as ff, h5py.File(args.out, 'w') as fo:
        g_feat = fo.create_group('features')
        for image in tqdm(sorted(rec.images.values(), key=lambda im: im.name), desc='images'):
            obs = [(k, p2.point3D_id) for k, p2 in enumerate(image.points2D) if p2.has_point3D()]
            if len(obs) < args.min_points:
                continue
            center = image.projection_center()
            li = int(np.argmin(np.abs(level_z - center[2])))
            if abs(level_z[li] - center[2]) > 2.0:  # stairs between floors
                continue
            g = ff[image.name]
            kidx = np.array([k for k, _ in obs])
            p3d = np.array([point_ids.setdefault(pid, len(point_ids)) for _, pid in obs], np.int32)
            i = len(names)
            gi = g_feat.create_group(str(i))
            gi.create_dataset('kp', data=g['keypoints'][()][kidx].astype(np.float32))
            gi.create_dataset('desc', data=g['descriptors'][()].T[kidx].astype(np.float16))
            gi.create_dataset('p3d', data=p3d)
            names.append(image.name)
            centers.append(to_world(center))
            sizes.append(g['image_size'][()])
            image_level.append(li)
        pts = np.zeros((len(point_ids), 3))
        for pid, j in point_ids.items():
            pts[j] = rec.points3D[pid].xyz
        fo.create_dataset('points', data=to_world(pts).astype(np.float32))
        fo.create_dataset('names', data=np.array(names, dtype=h5py.string_dtype()))
        fo.create_dataset('centers', data=np.array(centers, np.float32))
        fo.create_dataset('image_sizes', data=np.array(sizes, np.int32))
        fo.create_dataset('image_level', data=np.array(image_level, np.int32))
        fo.attrs['scene'] = args.scene
        fo.attrs['origin_lng'], fo.attrs['origin_lat'] = geo['origin']
        fo.attrs['levels'] = json.dumps([{'id': lv['id'], 'z': lv['z'], 'cameraZ': lv['cameraZ']} for lv in geo['levels']])
    print(f'{args.out}: {len(names)} images, {len(point_ids)} points, {args.out.stat().st_size / 1e6:.0f} MB')


if __name__ == '__main__':
    main()
