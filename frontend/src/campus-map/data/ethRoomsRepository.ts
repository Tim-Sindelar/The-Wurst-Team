import type { EthRoomsResponse } from '../domain/ethRooms';

// GET {base}/eth/*, answered by server/ethRoomsApi.ts, which forwards to eth_room_dashboard.py.

const BASE = `${import.meta.env.VITE_MAP_API_BASE ?? '/api'}/eth`;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error(
      (body as { error?: string } | null)?.error ?? `${url}: ${res.status}`,
    );
  return body as T;
}

/** All rooms with the bookings of `date` (null: today) and their places on the floor plans. ETH is asked at most hourly. */
export const fetchEthRooms = (date: string | null = null) =>
  getJson<EthRoomsResponse>(
    `${BASE}/rooms${date ? `?date=${encodeURIComponent(date)}` : ''}`,
  );

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

export const fetchRoomSheet = (id: string) =>
  getJson<RoomSheet>(`${BASE}/room?id=${encodeURIComponent(id)}`);

/** Room photo or attachment (PDF) from ETH. */
export const ethFileUrl = (id: number | string) =>
  `${BASE}/file?id=${encodeURIComponent(String(id))}`;

export interface UzhLocation {
  id: string;
  name: string;
  /** The widget's own text, e.g. "45% occupied" or "closed". */
  label: string;
  fraction: number | null;
}

export const fetchUzh = () =>
  getJson<{ fetchedAt: string; source: string; locations: UzhLocation[] }>(
    `${BASE}/uzh`,
  );

/** The official ETH page of a room. */
export function officialRoomUrl(id: string) {
  const [building, floor, room] = id.split(' ');
  const q = new URLSearchParams({ building, floor, room });
  return `https://ethz.ch/staffnet/en/service/rooms-and-buildings/roominfo/detail.html?${q}`;
}
