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

export const fetchRoomSheet = async (id: string) =>
  (await unwrap(getEthRoom({ query: { id } }))) as RoomSheet;

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
