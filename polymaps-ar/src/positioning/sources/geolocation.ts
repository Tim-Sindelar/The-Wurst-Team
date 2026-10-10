/**
 * GPS / browser geolocation, ported from the PolyMaps web viewer's "Bluedot" module
 * (arcgis-prd-web.ethz.ch/portal/apps/indoors, static/js/main.*.js):
 *
 *   navigator.geolocation.watchPosition(onPosition, onError,
 *       { enableHighAccuracy: true, maximumAge: 0, timeout: 15e3 })
 *   onPosition: drop duplicates of the last position, find the facility whose footprint contains
 *   the point, and if the platform reports coords.floorLevel (iOS indoor positioning), take the
 *   level with that vertical order in the facility (levelsByVO); draw an accuracy circle of
 *   coords.accuracy metres.
 *
 * The web viewer only enables this on iOS when the app's indoorPositioning.iOS flag is set (it is
 * false for ETH), because a browser has no access to the beacons; the beacon positioning itself runs
 * in the native ETH App. Here it is the GPS baseline the BLE engine is compared with.
 */
import { inMultiPolygon, type LngLat } from '../../geo';
import type { FixSource, PositionFix } from '../types';

export const BLUEDOT_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 15e3 };

export interface Facility {
  id: string;
  outline: { coordinates: number[][][][] };
}

export interface LevelLookup {
  facilities: Facility[];
  /** LEVEL_ID -> [FACILITY_ID, VERTICAL_ORDER] */
  levelInfo: Record<string, [string, number]>;
}

/** Facility containing the point (Bluedot: facilityFootprints.findFacilityIdByPoint). */
export function findFacility(p: LngLat, facilities: Facility[]): string | null {
  return facilities.find((f) => inMultiPolygon(p, f.outline.coordinates))?.id ?? null;
}

/** Bluedot: facilityData.levelsByVO[coords.floorLevel]. */
export function levelByVerticalOrder(facilityId: string, verticalOrder: number, levelInfo: LevelLookup['levelInfo']): string | null {
  for (const [levelId, [facility, vo]] of Object.entries(levelInfo)) {
    if (facility === facilityId && vo === verticalOrder) return levelId;
  }
  return null;
}

export class GeolocationSource implements FixSource {
  readonly name = 'GPS (browser geolocation)';
  private watchId: number | null = null;
  private last: GeolocationCoordinates | null = null;
  private readonly lookup: LevelLookup | null;

  constructor(lookup: LevelLookup | null = null) {
    this.lookup = lookup;
  }

  toFix(position: GeolocationPosition): PositionFix {
    const c = position.coords;
    const p = { lng: c.longitude, lat: c.latitude };
    let levelId: string | null = null;
    // Non-standard: iOS exposes the floor from Apple's indoor positioning in some venues.
    const floorLevel = (c as GeolocationCoordinates & { floorLevel?: number }).floorLevel;
    const facilityId = this.lookup ? findFacility(p, this.lookup.facilities) : null;
    if (this.lookup && facilityId && typeof floorLevel === 'number') {
      levelId = levelByVerticalOrder(facilityId, floorLevel, this.lookup.levelInfo);
    }
    return {
      method: 'gps',
      ...p,
      levelId,
      accuracy: c.accuracy,
      timestamp: position.timestamp,
      info: { ...(facilityId ? { facility: facilityId } : {}), ...(c.altitude != null ? { altitude: Math.round(c.altitude) } : {}) },
    };
  }

  async start(onFix: (fix: PositionFix) => void, onError?: (error: Error) => void): Promise<void> {
    if (!('geolocation' in navigator)) throw new Error('Geolocation API is unsupported.');
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords, l = this.last;
        // Bluedot ignores exact repeats of the previous position.
        if (l && l.latitude === c.latitude && l.longitude === c.longitude && l.accuracy === c.accuracy && l.altitude === c.altitude) return;
        this.last = c;
        onFix(this.toFix(pos));
      },
      (err) => onError?.(new Error(`Geolocation: ${err.message} (code ${err.code})`)),
      BLUEDOT_OPTIONS,
    );
  }

  stop(): void {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.last = null;
  }
}
