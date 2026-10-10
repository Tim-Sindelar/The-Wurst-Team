import { getEthRoom, getEthRooms, getUzhOccupancy } from '../../api/generated';
import type { EthRoomsResponse } from '../domain/ethRooms';
import { MAP_API, unwrap } from './api';

// GET /api/v1/map/eth/*: ETH room bookings and room sheets, UZH library occupancy.

/** All rooms with the bookings of `date` (null: today) and their places on the floor plans. ETH is asked at most hourly. */
export const fetchEthRooms = async (date: string | null = null) =>
  (await unwrap(
    getEthRooms({ query: { date: date ?? undefined } }),
  )) as unknown as EthRoomsResponse;

export interface RoomSheetAttribute {
  label: string;
  value: string | null;
  isAttachment?: boolean;
  attachmentId?: number | string;
  name?: string;
}

export interface RoomSheetFile {
  id: number | string;
  filename?: string;
  altText?: string;
}

/** The full room sheet of the ETH Room Info page: tabs of attributes, photos and attachments. */
export interface RoomSheet {
  tabs?: {
    title?: string;
    attributes?: RoomSheetAttribute[];
    attachments?: Record<string, RoomSheetFile[] | null>;
  }[];
  orgunits?: { name: string }[];
}

const sheets = new Map<string, Promise<RoomSheet>>();

/** The room sheet of an ETH room, asked for once per page load (failures are asked again). */
export function fetchRoomSheet(id: string): Promise<RoomSheet> {
  let sheet = sheets.get(id);
  if (!sheet) {
    sheet = unwrap(getEthRoom({ query: { id } })).then((r) => r as RoomSheet);
    sheet.catch(() => sheets.delete(id));
    sheets.set(id, sheet);
  }
  return sheet;
}

/** The photos of a room sheet. */
export function sheetImages(sheet: RoomSheet | null | undefined) {
  const images: RoomSheetFile[] = [];
  for (const tab of sheet?.tabs ?? [])
    for (const f of tab.attachments?.images ?? []) images.push(f);
  return images;
}

/**
 * The ETH room id a PolyMaps room would have, from its unit id:
 * "ETH.HG.E.E_033.1" → "HG E 33.1". A guess for while the room list (which
 * holds the real matches) is not loaded yet.
 */
export function guessEthId(unitId: string): string | null {
  const [, building, , first, ...rest] = unitId.split('.');
  const sep = first?.indexOf('_') ?? -1;
  if (!building || sep <= 0) return null;
  const number = [first.slice(sep + 1), ...rest]
    .join('.')
    .replace(/\d+/g, (d) => String(Number(d)));
  return `${building} ${first.slice(0, sep)} ${number}`;
}

/** Room photo or attachment (PDF) from ETH. */
export const ethFileUrl = (id: number | string) =>
  `${MAP_API}/eth/file?id=${encodeURIComponent(String(id))}`;

export interface UzhLocation {
  id: string;
  name: string;
  /** The widget's own text, e.g. "45% occupied" or "closed". */
  label: string;
  fraction: number | null;
}

export const fetchUzh = async () =>
  (await unwrap(getUzhOccupancy())) as {
    fetchedAt: string;
    source: string;
    locations: UzhLocation[];
  };

/** The official ETH page of a room. */
export function officialRoomUrl(id: string) {
  const [building, floor, room] = id.split(' ');
  const q = new URLSearchParams({ building, floor, room });
  return `https://ethz.ch/staffnet/en/service/rooms-and-buildings/roominfo/detail.html?${q}`;
}
