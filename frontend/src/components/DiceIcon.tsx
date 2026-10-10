/* A 3D die (isometric cube; `faces` sets what it shows, 1 2 3 by default) for "choose any free seat".
   An illustration rather than part of the outline icon set, so it lives here.
   Faces use text tokens so it reads in both themes; pips use the page colour.
   Drawn as smooth vector paths with rounded corners, crisp at any pixel density. */
import type { DiceFaces } from './diceFaces';

type Point = [number, number];

/* Face outline with rounded corners: each corner is a quadratic curve that
   starts and ends `radius` along its two edges. Faces are shrunk a little
   toward their centre so a thin seam shows between them. */
function roundedFace(points: Point[], radius: number, shrink = 0.94) {
  const cx = points.reduce((sum, [x]) => sum + x, 0) / points.length;
  const cy = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
  const p = points.map(([x, y]): Point => [
    cx + (x - cx) * shrink,
    cy + (y - cy) * shrink,
  ]);
  const toward = ([ax, ay]: Point, [bx, by]: Point): Point => {
    const length = Math.hypot(bx - ax, by - ay);
    const t = Math.min(radius, length / 2) / length;
    return [ax + (bx - ax) * t, ay + (by - ay) * t];
  };
  const fmt = ([x, y]: Point) => `${x.toFixed(2)} ${y.toFixed(2)}`;
  return (
    p
      .map((corner, index) => {
        const before = toward(corner, p[(index + p.length - 1) % p.length]);
        const after = toward(corner, p[(index + 1) % p.length]);
        return `${index === 0 ? 'M' : 'L'}${fmt(before)}Q${fmt(corner)} ${fmt(after)}`;
      })
      .join('') + 'Z'
  );
}

const CORNER = 3.2;
const top = roundedFace(
  [
    [24, 3],
    [42, 13.5],
    [24, 24],
    [6, 13.5],
  ],
  CORNER,
);
const left = roundedFace(
  [
    [6, 13.5],
    [24, 24],
    [24, 45],
    [6, 34.5],
  ],
  CORNER,
);
const right = roundedFace(
  [
    [24, 24],
    [42, 13.5],
    [42, 34.5],
    [24, 45],
  ],
  CORNER,
);

/* Pip positions on a face, in unit-square coordinates. */
const col = [0.28, 0.72];
const pips: Record<number, Point[]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.28, 0.28],
    [0.72, 0.72],
  ],
  3: [
    [0.25, 0.25],
    [0.5, 0.5],
    [0.75, 0.75],
  ],
  4: col.flatMap((x): Point[] => col.map((y): Point => [x, y])),
  5: [
    ...col.flatMap((x): Point[] => col.map((y): Point => [x, y])),
    [0.5, 0.5],
  ],
  6: [0.25, 0.5, 0.75].flatMap((y): Point[] => [
    [0.3, y],
    [0.7, y],
  ]),
};

export function DiceIcon({
  faces = [1, 2, 3],
  className,
}: {
  faces?: DiceFaces;
  className?: string;
}) {
  const [topFace, leftFace, rightFace] = faces;
  const face = (value: number, matrix: string) => (
    <g transform={`matrix(${matrix})`}>
      {pips[value].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={value === 1 ? 0.13 : 0.11} />
      ))}
    </g>
  );
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path className="fill-text" d={top} />
      <path className="fill-text-muted" d={left} />
      <path className="fill-border-strong" d={right} />
      <g className="fill-bg">
        {/* Each group maps a unit square onto its face. */}
        {face(topFace, '18 10.5 -18 10.5 24 3')}
        {face(leftFace, '18 10.5 0 21 6 13.5')}
        {face(rightFace, '18 -10.5 0 21 24 24')}
      </g>
    </svg>
  );
}
