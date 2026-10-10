/** Exact room labels must appear before prefix matches and utility-room results. */
export function searchRooms<T extends { use: string; kind?: string }>(
  rooms: T[],
  query: string,
  labelOf: (room: T) => string,
): T[] {
  const normalize = (value: string) =>
    value.toLowerCase().trim().replace(/\s+/g, ' ');
  const term = normalize(query);
  const score = (room: T) => {
    const label = normalize(labelOf(room));
    return term
      ? label === term
        ? 0
        : label.startsWith(term)
          ? 1
          : 2
      : ['library', 'teaching', 'study'].includes(room.kind || '')
        ? 0
        : 1;
  };
  return rooms
    .filter((r) => normalize(labelOf(r) + ' ' + r.use).includes(term))
    .sort(
      (a, b) =>
        score(a) - score(b) ||
        labelOf(a).localeCompare(labelOf(b), undefined, { numeric: true }),
    );
}
