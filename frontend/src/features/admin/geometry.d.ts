import type { Feature, LayoutItem, RoomGeometry, Tool } from './models';
type Slot = LayoutItem & { slot: string; tableId: string };
interface Geometry {
  UNITS_PER_METER: number;
  SEAT_GAP: number;
  SEAT_PITCH: number;
  TABLE_SIZES: number[];
  WALL_SIZES: number[];
  BADGES: Record<Feature, string>;
  rooms: RoomGeometry[];
  room(id?: string | null): RoomGeometry | undefined;
  roomFromCoordinates(data: Record<string, unknown>): RoomGeometry;
  sourcePoint(
    room: RoomGeometry,
    x: number,
    y: number,
  ): { x: number; y: number };
  clone<T>(value: T): T;
  renumber(items: LayoutItem[]): LayoutItem[];
  normalize(room: RoomGeometry, items: LayoutItem[]): LayoutItem[];
  assertLayout(room: RoomGeometry, items: LayoutItem[]): void;
  slots(item: LayoutItem): Slot[];
  rowSlots(item: LayoutItem): Slot[];
  curveOutline(item: LayoutItem): [number, number][];
  curvePoints(item: LayoutItem): [number, number][];
  place(
    room: RoomGeometry,
    items: LayoutItem[],
    tool: Tool,
    x: number,
    y: number,
    id: string,
  ): LayoutItem[];
  move(
    room: RoomGeometry,
    items: LayoutItem[],
    id: string,
    x: number,
    y: number,
  ): LayoutItem[];
  update(
    room: RoomGeometry,
    items: LayoutItem[],
    id: string,
    patch: Partial<LayoutItem>,
  ): LayoutItem[];
  remove(items: LayoutItem[], id: string): LayoutItem[];
  toggleBadge(items: LayoutItem[], id: string, badge: Feature): LayoutItem[];
  resize(
    room: RoomGeometry,
    items: LayoutItem[],
    id: string,
    handle: string,
    x: number,
    y: number,
  ): LayoutItem[];
  resizeBy(
    room: RoomGeometry,
    items: LayoutItem[],
    id: string,
    handle: string,
    dx: number,
    dy: number,
  ): LayoutItem[];
  handlePoint(item: LayoutItem, handle: string): { x: number; y: number };
  overlaps(a: LayoutItem, b: LayoutItem): boolean;
  valid(room: RoomGeometry, item: LayoutItem): boolean;
}
declare const geometry: Geometry;
export default geometry;
