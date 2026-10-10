type Point = { id: string; x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };

/** Seats at different tables count as this much further apart, so a group is
    kept at one table whenever one has room for everybody. */
const otherTablePenalty = 1000;

/** The table a seat belongs to: the one whose centre is nearest. */
function tableOf(seat: Point, tables: Rect[]) {
  let best = -1;
  let bestDistance = Infinity;
  tables.forEach((table, index) => {
    const distance = Math.hypot(
      seat.x - (table.x + table.width / 2),
      seat.y - (table.y + table.height / 2),
    );
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/** `count` free seats close together: at one table if any table has room,
    otherwise the tightest cluster. In seat order; null if there aren't enough. */
export function seatTogether(
  free: Point[],
  count: number,
  tables: Rect[],
): string[] | null {
  if (count <= 0 || free.length < count) return null;
  const table = new Map(free.map((seat) => [seat.id, tableOf(seat, tables)]));
  let best: { cost: number; seats: Point[] } | null = null;
  for (const anchor of free) {
    const nearest = free
      .map((seat) => ({
        seat,
        distance:
          Math.hypot(seat.x - anchor.x, seat.y - anchor.y) +
          (table.get(seat.id) === table.get(anchor.id) ? 0 : otherTablePenalty),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, count);
    const cost = nearest.reduce((sum, item) => sum + item.distance, 0);
    if (!best || cost < best.cost)
      best = { cost, seats: nearest.map((item) => item.seat) };
  }
  return best!.seats
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((seat) => seat.id);
}
