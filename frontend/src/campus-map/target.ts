/** What a tap on the campus map selected. A second tap on the same target opens the dashboard. */
export type MapTarget =
  | { kind: 'room'; id: string }
  | { kind: 'library'; id: string; tableId?: string }
  | { kind: 'dataset'; datasetId: string; itemId: string };

export function sameTarget(a: MapTarget | null, b: MapTarget): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === 'dataset' && b.kind === 'dataset')
    return a.datasetId === b.datasetId && a.itemId === b.itemId;
  return 'id' in a && 'id' in b && a.id === b.id;
}
