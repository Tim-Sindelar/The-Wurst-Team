/** What the three visible faces show: top, left, right. */
export type DiceFaces = [number, number, number];

/** A real die's corner: one face from each opposite pair (1/6, 2/5, 3/4),
   in the order a standard die shows them. Any of these can be rolled. */
export function randomDiceFaces(): DiceFaces {
  const a = Math.random() < 0.5 ? 1 : 6;
  const b = Math.random() < 0.5 ? 2 : 5;
  const c = Math.random() < 0.5 ? 3 : 4;
  /* An odd number of flipped faces mirrors the corner, so swap two to keep it a real die. */
  const flipped = [a === 6, b === 5, c === 4].filter(Boolean).length;
  const corner: DiceFaces = flipped % 2 === 0 ? [a, b, c] : [a, c, b];
  const turn = Math.floor(Math.random() * 3);
  return [0, 1, 2].map((n) => corner[(n + turn) % 3]) as DiceFaces;
}
