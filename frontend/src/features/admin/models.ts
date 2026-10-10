export type Feature = 'outlet' | 'monitor' | 'quiet';
export type ItemType = 'table' | 'seat' | 'window' | 'door' | 'row';
export type Tool = 'select' | ItemType | 'round' | 'l' | 'curved' | Feature;
export interface RoomGeometry {
  id: string;
  label: string;
  kind: string;
  width: number;
  height: number;
  points: [number, number][];
  /** Inner rings (pillars, shafts). Drawn only: furniture isn't checked against them. */
  holes?: [number, number][][];
  measurements: {
    unitsPerMeter: number;
    widthMeters: number;
    heightMeters: number;
    areaSquareMeters: number;
    approximate: boolean;
  };
  sourceTransform: {
    originX: number;
    originY: number;
    maxY: number;
    scale: number;
    padding: number;
    axis: string;
    canvasTransform?: { rotation: number; offsetX: number; offsetY: number };
  };
  mapRef?: {
    workspaceId?: string;
    unitId?: string;
    levelId?: string;
    facilityId?: string;
    floor?: number;
  };
  georeference?: {
    origin: { lat: number; lng: number };
    metersLat: number;
    metersLng: number;
  };
  coordinateSource?: unknown;
}
export interface LayoutItem {
  id: string;
  type: ItemType;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  label?: string;
  shape?: 'rect' | 'round' | 'l' | 'curved';
  number?: number;
  tableId?: string;
  slot?: string;
  badges?: Feature[];
  curvature?: number;
  rows?: number;
  count?: number;
  radius?: number;
  sweep?: number;
  rowGap?: number;
  state?: string;
  active?: boolean;
  backendSeatId?: string;
  backendLabel?: string;
}
export interface LayoutDocument {
  schemaVersion: 1;
  unitsPerMeter: number;
  room: RoomGeometry;
  objects: LayoutItem[];
}
