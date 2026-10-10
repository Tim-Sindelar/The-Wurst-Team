import type { LayoutDocument } from './models';

/** Choose the main wall direction, combining parallel and perpendicular edges. */
function wallRotation(points: [number, number][]) {
  const edges = points.flatMap(([x, y], i) => {
    const [nx, ny] = points[(i + 1) % points.length];
    const length = Math.hypot(nx - x, ny - y);
    const angle = (Math.atan2(ny - y, nx - x) * 180) / Math.PI;
    return length > 0.001 ? [{ length, angle: ((angle + 225) % 90) - 45 }] : [];
  });
  const distance = (a: number, b: number) =>
    Math.min(Math.abs(a - b), 90 - Math.abs(a - b));
  const ranked = edges.map((edge) => ({
    ...edge,
    weight: edges.reduce(
      (sum, other) =>
        sum + (distance(edge.angle, other.angle) < 2 ? other.length : 0),
      0,
    ),
  }));
  ranked.sort((a, b) => b.weight - a.weight || b.length - a.length);
  return -(ranked[0]?.angle || 0);
}

/** Align the editor canvas without changing the room's geographic coordinates. */
export function alignLayoutWalls(document: LayoutDocument): LayoutDocument {
  const { room } = document;
  const degrees = wallRotation(room.points);
  if (Math.abs(degrees) < 0.000001) return document;
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians),
    sine = Math.sin(radians);
  const rotate = (x: number, y: number): [number, number] => [
    x * cosine - y * sine,
    x * sine + y * cosine,
  ];
  const rotated = room.points.map(([x, y]) => rotate(x, y));
  const minX = Math.min(...rotated.map(([x]) => x));
  const minY = Math.min(...rotated.map(([, y]) => y));
  const maxX = Math.max(...rotated.map(([x]) => x));
  const maxY = Math.max(...rotated.map(([, y]) => y));
  const padding = room.sourceTransform.padding;
  const offsetX = padding - minX,
    offsetY = padding - minY;
  const previous = room.sourceTransform.canvasTransform;
  const oldOffset = previous
    ? rotate(previous.offsetX, previous.offsetY)
    : [0, 0];
  const translate = (x: number, y: number): [number, number] => {
    const [rx, ry] = rotate(x, y);
    return [rx + offsetX, ry + offsetY];
  };
  return {
    ...document,
    room: {
      ...room,
      points: room.points.map(([x, y]) => translate(x, y)),
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
      measurements: {
        ...room.measurements,
        widthMeters: (maxX - minX) / document.unitsPerMeter,
        heightMeters: (maxY - minY) / document.unitsPerMeter,
      },
      sourceTransform: {
        ...room.sourceTransform,
        canvasTransform: {
          rotation: (previous?.rotation || 0) + degrees,
          offsetX: oldOffset[0] + offsetX,
          offsetY: oldOffset[1] + offsetY,
        },
      },
    },
    objects: document.objects.map((item) => {
      const [x, y] = translate(item.x, item.y);
      return {
        ...item,
        x,
        y,
        angle: (((item.angle + degrees) % 360) + 360) % 360,
      };
    }),
  };
}
