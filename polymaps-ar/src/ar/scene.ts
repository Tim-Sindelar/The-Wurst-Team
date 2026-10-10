/**
 * Three.js meshes for one floor plan, in the AR world frame (x = east, y = up, z = south, metres
 * from the anchor): room footprints on the floor, translucent walls, door and stair lines, labels.
 */
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Path,
  Shape,
  ShapeGeometry,
  Sprite,
  SpriteMaterial,
} from 'three';
import { KIND_COLORS, type LevelPlan, type Room } from '../floors/floorPlans';

export interface SceneOptions {
  wallHeight: number;
  /** Rooms of these kinds get no fill (corridors would cover the whole view). */
  unfilledKinds: string[];
  /** Labels only for rooms at least this large (m²). */
  labelMinArea: number;
}

export const DEFAULT_SCENE: SceneOptions = { wallHeight: 2.6, unfilledKinds: ['circulation'], labelMinArea: 6 };

function ringToPath<T extends Path>(target: T, ring: Float32Array): T {
  // Plan (x east, y north) -> shape (x, y); the mesh is rotated onto the floor afterwards.
  target.moveTo(ring[0], ring[1]);
  for (let i = 2; i < ring.length; i += 2) target.lineTo(ring[i], ring[i + 1]);
  return target;
}

function roomMesh(room: Room): Mesh {
  const shapes = room.polygons.map((poly) => {
    const shape = ringToPath(new Shape(), poly[0]);
    shape.holes = poly.slice(1).map((h) => ringToPath(new Path(), h));
    return shape;
  });
  const geometry = new ShapeGeometry(shapes);
  geometry.rotateX(-Math.PI / 2); // (x, y, 0) -> (x, 0, -y): north becomes -z
  const material = new MeshBasicMaterial({
    color: new Color(KIND_COLORS[room.kind] ?? KIND_COLORS.other),
    transparent: true,
    opacity: 0.35,
    side: DoubleSide,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.position.y = 0.02;
  mesh.userData.roomId = room.id;
  return mesh;
}

/** Segments of polylines, at height y, as one LineSegments geometry. */
function lineGeometry(lines: Float32Array[], y: number): BufferGeometry {
  const pos: number[] = [];
  for (const l of lines) {
    for (let i = 0; i + 3 < l.length; i += 2) pos.push(l[i], y, -l[i + 1], l[i + 2], y, -l[i + 3]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

/** Vertical quads along wall polylines. */
function wallGeometry(lines: Float32Array[], height: number): BufferGeometry {
  const pos: number[] = [];
  for (const l of lines) {
    for (let i = 0; i + 3 < l.length; i += 2) {
      const [x0, z0, x1, z1] = [l[i], -l[i + 1], l[i + 2], -l[i + 3]];
      pos.push(x0, 0, z0, x1, 0, z1, x1, height, z1, x0, 0, z0, x1, height, z1, x0, height, z0);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

export function labelSprite(text: string, sub?: string): Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = 'bold 44px system-ui, sans-serif';
  const subFont = '32px system-ui, sans-serif';
  ctx.font = font;
  const w1 = ctx.measureText(text).width;
  ctx.font = subFont;
  const w2 = sub ? ctx.measureText(sub).width : 0;
  canvas.width = Math.ceil(Math.max(w1, w2) + 40);
  canvas.height = sub ? 112 : 68;
  ctx.fillStyle = 'rgba(20, 30, 50, 0.72)';
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 18);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';
  ctx.font = font;
  ctx.fillText(text, 20, 10);
  if (sub) {
    ctx.font = subFont;
    ctx.fillStyle = '#cfe0ff';
    ctx.fillText(sub, 20, 64);
  }
  const texture = new CanvasTexture(canvas);
  const sprite = new Sprite(new SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  const scale = 0.004; // metres per canvas pixel
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
  sprite.renderOrder = 10;
  return sprite;
}

export function buildLevelScene(plan: LevelPlan, options: Partial<SceneOptions> = {}): Group {
  const opt = { ...DEFAULT_SCENE, ...options };
  const group = new Group();
  group.name = plan.id;
  for (const room of plan.rooms) {
    if (!opt.unfilledKinds.includes(room.kind)) group.add(roomMesh(room));
    const name = room.label || room.name;
    if (name && room.area >= opt.labelMinArea && room.kind !== 'circulation') {
      const sprite = labelSprite(room.name ?? name, room.label && room.label !== room.name ? room.label : room.use || undefined);
      sprite.position.set(room.centroid.x, 1.9, -room.centroid.y);
      sprite.userData.label = true;
      group.add(sprite);
    }
  }
  const walls = new Mesh(
    wallGeometry(plan.walls, opt.wallHeight),
    new MeshBasicMaterial({ color: 0x9ec5ff, transparent: true, opacity: 0.18, side: DoubleSide, depthWrite: false }),
  );
  group.add(walls);
  const edges = new LineBasicMaterial({ color: 0xdbe9ff, transparent: true, opacity: 0.9 });
  group.add(new LineSegments(lineGeometry(plan.walls, 0.03), edges));
  group.add(new LineSegments(lineGeometry(plan.walls, opt.wallHeight), edges));
  group.add(new LineSegments(lineGeometry(plan.doors, 0.04), new LineBasicMaterial({ color: 0x3ddc84 })));
  group.add(new LineSegments(lineGeometry(plan.stairs, 0.04), new LineBasicMaterial({ color: 0xffc94d })));
  return group;
}

export function disposeGroup(group: Group): void {
  group.traverse((o) => {
    const m = o as Mesh;
    m.geometry?.dispose();
    const mat = m.material as (MeshBasicMaterial & { map?: { dispose(): void } }) | undefined;
    mat?.map?.dispose();
    mat?.dispose?.();
  });
}
