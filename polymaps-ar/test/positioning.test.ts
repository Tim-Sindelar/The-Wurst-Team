import { describe, expect, it } from 'vitest';
import { distance, fromLocal, seededRandom } from '../src/geo';
import { evaluate } from '../src/evaluation/metrics';
import { sessionSamples, type Session } from '../src/evaluation/session';
import { aggregate, BlePositioningEngine } from '../src/positioning/engine';
import { locate } from '../src/positioning/fingerprint';
import { encodeIBeacon, parseIBeacon } from '../src/positioning/ibeacon';
import { RadioMap, type RadioMapIndex } from '../src/positioning/radioMap';
import { SimulatedBeaconSource } from '../src/positioning/sources/simulated';
import type { PositionFix } from '../src/positioning/types';

const UUID = '58793564-459C-548D-BFCC-367FFD4FCD70';
const ORIGIN = { lng: 8.5476, lat: 47.3763 };

/**
 * A synthetic corridor 60 m long on two floors, with a beacon every 6 m; RSSI falls off with
 * distance (log-distance model). Written in the same binary format as extract_ips.py.
 */
function syntheticMap(): RadioMap {
  const beacons: RadioMapIndex['beacons'] = [];
  for (let level = 0; level < 2; level++) {
    for (let k = 0; k <= 10; k++) {
      const p = fromLocal(k * 6, 0, ORIGIN);
      beacons.push([level, k, p.lng, p.lat, level]);
    }
  }
  const points: { lng: number; lat: number; level: number; fp: [number, number, number][] }[] = [];
  for (let level = 0; level < 2; level++) {
    for (let x = 0; x <= 60; x += 0.75) {
      for (const y of [-1, 0, 1]) {
        const fp: [number, number, number][] = [];
        beacons.forEach(([, , , , bl], b) => {
          const bx = (b % 11) * 6;
          const d = Math.hypot(x - bx, y) + 1;
          const mean = -60 - 20 * Math.log10(d) - (bl === level ? 0 : 15);
          if (mean > -100) fp.push([b, mean, 4]);
        });
        points.push({ ...fromLocal(x, y, ORIGIN), level, fp });
      }
    }
  }
  const tiles: Record<string, ArrayBuffer> = {};
  const byKey = new Map<string, typeof points>();
  const tileDeg = 0.002;
  for (const p of points) {
    const key = `${Math.floor(p.lng / tileDeg)}_${Math.floor(p.lat / tileDeg)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), p]);
  }
  for (const [key, pts] of byKey) {
    const size = 4 + pts.reduce((a, p) => a + 20 + 6 * p.fp.length, 0);
    const view = new DataView(new ArrayBuffer(size));
    view.setUint32(0, pts.length, true);
    let pos = 4;
    for (const p of pts) {
      view.setFloat64(pos, p.lng, true);
      view.setFloat64(pos + 8, p.lat, true);
      view.setUint16(pos + 16, p.level, true);
      view.setUint16(pos + 18, p.fp.length, true);
      pos += 20;
      for (const [b, mean, std] of p.fp) {
        view.setUint16(pos, b, true);
        view.setInt16(pos + 2, Math.round(mean * 10), true);
        view.setUint16(pos + 4, std * 10, true);
        pos += 6;
      }
    }
    tiles[key] = view.buffer;
  }
  const index: RadioMapIndex = {
    uuid: [UUID],
    tileDeg,
    levels: ['ETH.TST.E', 'ETH.TST.F'],
    levelInfo: { 'ETH.TST.E': ['ETH.TST', 0], 'ETH.TST.F': ['ETH.TST', 1] },
    tiles: Object.fromEntries([...byKey].map(([k, v]) => [k, v.length])),
    beacons,
    source: 'test',
  };
  return new RadioMap(index, async (key) => tiles[key]);
}

describe('iBeacon', () => {
  it('round-trips a frame', () => {
    const frame = { uuid: UUID, major: 12, minor: 3456, txPower: -59 };
    expect(parseIBeacon(encodeIBeacon(frame))).toEqual(frame);
  });
  it('rejects other manufacturer data', () => {
    expect(parseIBeacon(new DataView(new Uint8Array([0x10, 0x05, 1, 2, 3]).buffer))).toBeNull();
  });
});

describe('fingerprint locator', () => {
  it('finds the position and floor from a noiseless scan', async () => {
    const map = syntheticMap();
    await map.ensureTiles(Object.keys(map.index.tiles));
    const truth = fromLocal(21, 0, ORIGIN);
    const near = map.nearestPoint(truth, 1)!;
    const obs = [];
    for (let e = near.tile.offsets[near.i]; e < near.tile.offsets[near.i + 1]; e++) {
      obs.push({ beacon: near.tile.beacon[e], rssi: near.tile.mean[e] });
    }
    const est = locate(map, obs)!;
    expect(est.levelId).toBe('ETH.TST.F');
    expect(distance(est, truth)).toBeLessThan(2);
  });

  it('ignores beacons of other systems', () => {
    const map = syntheticMap();
    const obs = aggregate(map, [{ uuid: 'AAAAAAAA-0000-0000-0000-000000000000', major: 0, minor: 1, rssi: -60, timestamp: 0 }], 0, 1000);
    expect(obs).toHaveLength(0);
  });

  it('tracks a simulated phone with an unknown RSSI offset', async () => {
    const map = syntheticMap();
    const rand = seededRandom(7);
    const sim = new SimulatedBeaconSource(map, { ...fromLocal(40, 0, ORIGIN), levelIndex: 0 }, { deviceOffset: -8 }, rand);
    const engine = new BlePositioningEngine(map, sim);
    let fix: PositionFix | null = null;
    for (let t = 1000; t <= 12_000; t += 1000) {
      engine.ingest((await sim.sample(t)) ?? []);
      fix = await engine.step(t);
    }
    expect(fix).not.toBeNull();
    expect(fix!.levelId).toBe('ETH.TST.E');
    expect(distance(fix!, sim.truth!)).toBeLessThan(5);
    // The phone reports RSSI 8 dB too strong; the engine should find most of that.
    expect(engine.deviceOffset).toBeLessThan(-3);
  });
});

describe('evaluation', () => {
  it('scores BLE and GPS with the same rules', () => {
    const truth = { ...ORIGIN, levelId: 'ETH.TST.E' };
    const at = (method: 'ble' | 'gps', dx: number, t: number, levelId: string | null): PositionFix => ({
      method, ...fromLocal(dx, 0, ORIGIN), levelId, accuracy: 5, timestamp: t,
    });
    const session: Session = {
      version: 1, startedAt: '', userAgent: '', description: '',
      checkpoints: [{ id: 1, truth, start: 0, end: 10_000 }],
      fixes: [
        ...[1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10_000].map((t) => at('ble', 2, t, 'ETH.TST.E')),
        // GPS: one fix at 9 s; everything before has no fresh fix.
        at('gps', 20, 9000, null),
      ],
    };
    const stats = evaluate(sessionSamples(session, ['ble', 'gps']));
    const ble = stats.find((s) => s.method === 'ble')!;
    const gps = stats.find((s) => s.method === 'gps')!;
    expect(ble.samples).toBe(8); // t = 3..10 s
    expect(ble.availability).toBe(1);
    expect(ble.median).toBeCloseTo(2, 1);
    expect(ble.floorRate).toBe(1);
    expect(gps.samples).toBe(8);
    expect(gps.availability).toBeCloseTo(2 / 8);
    expect(gps.median).toBeCloseTo(20, 0);
    expect(gps.floorRate).toBeNull();
    expect(gps.withinReportedAccuracy).toBe(0);
  });
});
