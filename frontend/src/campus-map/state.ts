export interface Selection {
  libraryId: string | null;
  tableId: string | null;
  seatId: string | null;
}

export const EMPTY_SELECTION: Selection = {
  libraryId: null,
  tableId: null,
  seatId: null,
};
