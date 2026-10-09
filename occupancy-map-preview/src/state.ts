export type Mode = 'view' | 'admin';

export type PlacingKind = 'library' | 'table' | 'seat';

export interface Selection {
  libraryId: string | null;
  tableId: string | null;
  seatId: string | null;
}

export const EMPTY_SELECTION: Selection = { libraryId: null, tableId: null, seatId: null };

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';
