/**
 * Simulated beacon scanner: draws RSSI readings from the radio map at a ground-truth position.
 *
 * Simulation is optimistic by construction (the readings come from the same model the locator
 * uses), so it adds what a real phone sees on top of the map's own spread:
 *   - a constant device offset (the locator must calibrate it away),
 *   - a per-beacon bias that changes slowly (body shadowing, people, doors),
 *   - dropouts: phones only report a share of advertisements, weak ones less often,
 *   - a detection threshold below which nothing is reported.
 * Use it to exercise the pipeline and for relative comparisons, never as the accuracy claim.
 */
import { gaussian, type LngLat } from '../../geo';
import type { RadioMap } from '../radioMap';
import type { BeaconReading, BeaconSource } from '../types';

export interface SimulationOptions {
  deviceOffset: number;
  /** Std of the per-beacon bias, dB. */
  biasStd: number;
  /** Bias correlation time, s. */
  biasTau: number;
  /** Multiplier on the radio map's std for per-reading noise. */
  noiseScale: number;
  /** Probability a given beacon is reported in a 1 s batch at -70 dBm (decays for weaker). */
  reportRate: number;
  detectionThreshold: number;
  intervalMs: number;
}

export const DEFAULT_SIMULATION: SimulationOptions = {
  deviceOffset: -6,
  biasStd: 4,
  biasTau: 10,
  noiseScale: 1,
  reportRate: 0.9,
  detectionThreshold: -100,
  intervalMs: 1000,
};

export interface SimulatedTruth extends LngLat {
  levelIndex: number;
}

export class SimulatedBeaconSource implements BeaconSource {
  readonly name = 'Simulation';
  private readonly map: RadioMap;
  private readonly opt: SimulationOptions;
  private readonly rand: () => number;
  private readonly bias = new Map<number, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  truth: SimulatedTruth | null;

  constructor(map: RadioMap, truth: SimulatedTruth | null, options: Partial<SimulationOptions> = {}, rand: () => number = Math.random) {
    this.map = map;
    this.truth = truth;
    this.opt = { ...DEFAULT_SIMULATION, ...options };
    this.rand = rand;
  }

  /** One batch of readings at the current truth (null if no fingerprint near it). */
  async sample(timestamp: number): Promise<BeaconReading[] | null> {
    const truth = this.truth;
    if (!truth) return null;
    await this.map.ensureTiles(this.map.tilesAround(truth, 60));
    const near = this.map.nearestPoint(truth, truth.levelIndex);
    if (!near || near.distance > 5) return null;
    const { tile, i } = near;
    const o = this.opt;
    const decay = Math.exp(-o.intervalMs / 1000 / o.biasTau);
    const readings: BeaconReading[] = [];
    for (let e = tile.offsets[i]; e < tile.offsets[i + 1]; e++) {
      const b = tile.beacon[e];
      const prev = this.bias.get(b) ?? gaussian(this.rand) * o.biasStd;
      const bias = prev * decay + Math.sqrt(1 - decay * decay) * o.biasStd * gaussian(this.rand);
      this.bias.set(b, bias);
      const rssi = tile.mean[e] + bias + o.noiseScale * tile.std[e] * gaussian(this.rand);
      const reported = rssi - o.deviceOffset;
      if (rssi < o.detectionThreshold) continue;
      const rate = o.reportRate * Math.min(1, Math.exp((rssi + 70) / 15));
      if (this.rand() > rate) continue;
      const [major, minor] = this.map.index.beacons[b];
      readings.push({ uuid: this.map.index.uuid[0], major, minor, rssi: Math.round(reported), timestamp });
    }
    return readings;
  }

  async start(onReadings: (readings: BeaconReading[]) => void): Promise<void> {
    this.timer = setInterval(() => {
      this.sample(Date.now()).then((r) => r && onReadings(r)).catch(console.error);
    }, this.opt.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
