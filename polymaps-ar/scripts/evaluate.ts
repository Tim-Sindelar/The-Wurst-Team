/**
 * Offline accuracy evaluation, using the same evaluate() as the app.
 *
 *   npm run evaluate -- session.json [more.json ...]   re-evaluate exported field test sessions
 *   npm run evaluate -- --simulate [--n 200] [--seed 1] [--walk]
 *       BLE engine on simulated scans at random radio map points (stand still, or --walk along
 *       the surveyed corridors at 1.2 m/s). Optimistic by construction, see sources/simulated.ts.
 *       Tuning: --window <ms> (scan window), --speed <m/s> (tracker process noise).
 */
import { readFileSync } from 'node:fs';
import { seededRandom, toLocal } from '../src/geo';
import { evaluate, formatStats, type Sample } from '../src/evaluation/metrics';
import { parseSession, sessionSamples } from '../src/evaluation/session';
import { BlePositioningEngine, DEFAULT_ENGINE } from '../src/positioning/engine';
import { DEFAULT_TRACKER } from '../src/positioning/tracker';
import type { Tile } from '../src/positioning/radioMap';
import { loadRadioMapFromDisk } from './diskRadioMap';
import { SimulatedBeaconSource } from '../src/positioning/sources/simulated';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

/** Next point of a walk: ~speed metres ahead on the same level, keeping roughly the heading. */
function walkStep(tile: Tile, i: number, heading: number, speed: number, rand: () => number): { i: number; heading: number } {
  const here = { lng: tile.lng[i], lat: tile.lat[i] };
  let best = -1, bestScore = -Infinity, bestHeading = heading;
  for (let j = 0; j < tile.count; j++) {
    if (tile.level[j] !== tile.level[i] || j === i) continue;
    const d = toLocal({ lng: tile.lng[j], lat: tile.lat[j] }, here);
    const dist = Math.hypot(d.x, d.y);
    if (dist < speed * 0.6 || dist > speed * 1.4) continue;
    const h = Math.atan2(d.y, d.x);
    const score = Math.cos(h - heading) + 0.3 * rand();
    if (score > bestScore) [best, bestScore, bestHeading] = [j, score, h];
  }
  if (best < 0 || bestScore < 0) return { i, heading: heading + Math.PI }; // dead end: turn around
  return { i: best, heading: bestHeading };
}

async function simulate(n: number, seed: number, walk: boolean): Promise<Sample[]> {
  const map = loadRadioMapFromDisk();
  const rand = seededRandom(seed);
  const keys = Object.keys(map.index.tiles);
  const weights = keys.map((k) => map.index.tiles[k]);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const samples: Sample[] = [];
  const steps = walk ? 40 : 12;
  const warmup = walk ? 5 : 4;
  for (let run = 0; run < n; run++) {
    // Random point, tiles weighted by their point count so every surveyed area is equally likely.
    let r = rand() * totalWeight, k = 0;
    while ((r -= weights[k]) > 0) k++;
    const [tile] = await map.ensureTiles([keys[k]]);
    let i = Math.floor(rand() * tile.count);
    let heading = rand() * 2 * Math.PI;
    const truthAt = (j: number) => ({ lng: tile.lng[j], lat: tile.lat[j], levelIndex: tile.level[j] });
    const sim = new SimulatedBeaconSource(map, truthAt(i), {}, rand);
    const tuning = { windowMs: arg('--window', DEFAULT_ENGINE.windowMs), tracker: { speed: arg('--speed', DEFAULT_TRACKER.speed) } };
    const engines = {
      'ble-tracked': new BlePositioningEngine(map, sim, tuning),
      'ble-single-scan': new BlePositioningEngine(map, sim, { ...tuning, raw: true }),
    };
    let t = 1_000_000;
    for (let s = 0; s < steps; s++, t += 1000) {
      if (walk && s > 0) ({ i, heading } = walkStep(tile, i, heading, 1.2, rand));
      sim.truth = truthAt(i);
      const readings = await sim.sample(t);
      for (const [method, engine] of Object.entries(engines)) {
        if (readings) engine.ingest(readings);
        const fix = await engine.step(t);
        if (s >= warmup) {
          samples.push({ method, truth: { lng: sim.truth.lng, lat: sim.truth.lat, levelId: map.levelId(sim.truth.levelIndex) }, fix });
        }
      }
    }
    if ((run + 1) % 25 === 0) process.stderr.write(`  ${run + 1}/${n} runs\n`);
  }
  return samples;
}

async function main() {
  const files = process.argv.slice(2).filter((a) => a.endsWith('.json'));
  if (process.argv.includes('--simulate')) {
    const walk = process.argv.includes('--walk');
    const n = arg('--n', 100);
    console.log(`Simulated BLE positioning, ${n} ${walk ? 'walks' : 'standing points'} (seed ${arg('--seed', 1)})`);
    console.log(formatStats(evaluate(await simulate(n, arg('--seed', 1), walk))));
    console.log('Errors in metres. Simulation draws scans from the radio map itself: an optimistic bound, not a field result.');
  }
  for (const file of files) {
    const session = parseSession(readFileSync(file, 'utf-8'));
    console.log(`\n${file}: ${session.description || '(no description)'}, ${session.checkpoints.length} checkpoints`);
    console.log(formatStats(evaluate(sessionSamples(session))));
  }
  if (!files.length && !process.argv.includes('--simulate')) {
    console.log('usage: npm run evaluate -- session.json | --simulate [--n 100] [--seed 1] [--walk]');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
