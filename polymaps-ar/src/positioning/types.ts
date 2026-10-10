/** One advertisement of an iBeacon as reported by a scanner. */
export interface BeaconReading {
  uuid: string;
  major: number;
  minor: number;
  rssi: number;
  /** Calibrated RSSI at 1 m, if the advertisement carried it. */
  txPower?: number;
  timestamp: number;
}

/** A position from any method; BLE and GPS fixes are evaluated with the same code. */
export interface PositionFix {
  method: 'ble' | 'gps';
  lng: number;
  lat: number;
  /** PolyMaps LEVEL_ID, or null when the method does not know the floor. */
  levelId: string | null;
  /** Estimated horizontal error radius in metres (68 %). */
  accuracy: number;
  timestamp: number;
  /** Method specific diagnostics (beacon count, RSSI offset, ...). */
  info?: Record<string, number | string>;
}

export interface BeaconSource {
  readonly name: string;
  start(onReadings: (readings: BeaconReading[]) => void): Promise<void>;
  stop(): void;
}

export interface FixSource {
  readonly name: string;
  start(onFix: (fix: PositionFix) => void, onError?: (error: Error) => void): Promise<void>;
  stop(): void;
}
