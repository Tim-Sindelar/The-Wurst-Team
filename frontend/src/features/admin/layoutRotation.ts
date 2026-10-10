import type { LayoutItem } from './models';

type Point = { x: number; y: number };

/** Rotate from the grabbed point, retaining the table's angle at drag start. */
export function rotationFromPointer(
  item: Pick<LayoutItem, 'x' | 'y' | 'angle'>,
  start: Point,
  point: Point,
  snap: boolean,
): number {
  const startX = start.x - item.x,
    startY = start.y - item.y,
    pointX = point.x - item.x,
    pointY = point.y - item.y;
  // The centre has no direction; avoid a jump when the pointer crosses it.
  if (
    Math.hypot(startX, startY) < 0.000001 ||
    Math.hypot(pointX, pointY) < 0.000001
  )
    return item.angle;
  const delta =
    ((Math.atan2(pointY, pointX) - Math.atan2(startY, startX)) * 180) / Math.PI;
  const angle = item.angle + delta;
  return (((snap ? Math.round(angle / 15) * 15 : angle) % 360) + 360) % 360;
}
