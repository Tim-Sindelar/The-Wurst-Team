/**
 * Synthetic GPS for exercising the comparison without a phone. Indoors a phone's fix is mostly a
 * slowly wandering offset of 10-40 m (multipath, Wi-Fi assistance) with a similar reported
 * accuracy; this mimics that shape. It is NOT data: field sessions are the only real comparison.
 */
import { fromLocal, gaussian } from '../../geo';
import type { FixSource, PositionFix } from '../types';
import type { SimulatedTruth } from './simulated';

export class SimulatedGpsSource implements FixSource {
  readonly name = 'GPS (simulated)';
  private timer: ReturnType<typeof setInterval> | null = null;
  private bias = { x: 0, y: 0 };
  private readonly getTruth: () => SimulatedTruth | null;
  private readonly rand: () => number;

  constructor(getTruth: () => SimulatedTruth | null, private readonly biasStd = 15, rand: () => number = Math.random) {
    this.getTruth = getTruth;
    this.rand = rand;
    this.bias = { x: gaussian(rand) * biasStd, y: gaussian(rand) * biasStd };
  }

  sample(timestamp: number): PositionFix | null {
    const truth = this.getTruth();
    if (!truth) return null;
    const decay = Math.exp(-1 / 30); // ~30 s correlation
    const k = Math.sqrt(1 - decay * decay) * this.biasStd;
    this.bias = { x: this.bias.x * decay + k * gaussian(this.rand), y: this.bias.y * decay + k * gaussian(this.rand) };
    const p = fromLocal(this.bias.x + 3 * gaussian(this.rand), this.bias.y + 3 * gaussian(this.rand), truth);
    return { method: 'gps', ...p, levelId: null, accuracy: Math.max(8, this.biasStd * (1 + 0.3 * gaussian(this.rand))), timestamp, info: { simulated: 'yes' } };
  }

  async start(onFix: (fix: PositionFix) => void): Promise<void> {
    this.timer = setInterval(() => {
      const fix = this.sample(Date.now());
      if (fix) onFix(fix);
    }, 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
