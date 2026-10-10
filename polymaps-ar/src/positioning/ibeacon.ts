/** iBeacon advertisement parsing (Apple manufacturer data, company id 0x004C). */

export const APPLE_COMPANY_ID = 0x004c;

export interface IBeaconFrame {
  uuid: string;
  major: number;
  minor: number;
  /** Calibrated RSSI at 1 m (signed). */
  txPower: number;
}

/**
 * Parses the manufacturer specific data *after* the 2-byte company id:
 *   0x02 0x15 | 16 byte proximity UUID | major (BE u16) | minor (BE u16) | tx power (i8)
 */
export function parseIBeacon(data: DataView): IBeaconFrame | null {
  if (data.byteLength < 23 || data.getUint8(0) !== 0x02 || data.getUint8(1) !== 0x15) return null;
  const hex: string[] = [];
  for (let i = 2; i < 18; i++) hex.push(data.getUint8(i).toString(16).padStart(2, '0'));
  const h = hex.join('').toUpperCase();
  return {
    uuid: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`,
    major: data.getUint16(18, false),
    minor: data.getUint16(20, false),
    txPower: data.getInt8(22),
  };
}

/** Builds the manufacturer data of an iBeacon frame (for tests and simulators). */
export function encodeIBeacon(frame: IBeaconFrame): DataView {
  const buf = new DataView(new ArrayBuffer(23));
  buf.setUint8(0, 0x02);
  buf.setUint8(1, 0x15);
  const hex = frame.uuid.replace(/-/g, '');
  for (let i = 0; i < 16; i++) buf.setUint8(2 + i, parseInt(hex.slice(2 * i, 2 * i + 2), 16));
  buf.setUint16(18, frame.major, false);
  buf.setUint16(20, frame.minor, false);
  buf.setInt8(22, frame.txPower);
  return buf;
}
