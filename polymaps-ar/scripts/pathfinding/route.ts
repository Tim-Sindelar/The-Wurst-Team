/**
 * Route between two rooms from the command line, on the files of build_navigation.py.
 *   npm run route -- "HG E 41" "CAB G 61"      (NAV_DIR=... to use another nav directory)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NavData, cellCenter, type NavIndex } from '../../src/pathfinding/navData';
import { describe, findRoute } from '../../src/pathfinding/route';

const dir = process.env.NAV_DIR ?? fileURLToPath(new URL('../../public/nav/', import.meta.url));

export function loadNavFromDisk(base = dir): NavData {
  const index = JSON.parse(readFileSync(`${base}/index.json`, 'utf-8')) as NavIndex;
  return new NavData(index, async (id) => {
    const b = readFileSync(`${base}/levels/${id}.bin`);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  });
}

async function main() {
  const [fromName, toName] = process.argv.slice(2);
  if (!fromName || !toName) return console.log('usage: npm run route -- "<from room>" "<to room>"');
  const nav = loadNavFromDisk();
  const place = (q: string) => {
    const room = nav.searchRooms(q, 1)[0];
    if (!room) throw new Error(`no room matches "${q}"`);
    const info = nav.level(room[2])!;
    return { ...cellCenter(info, nav.cell, room[3], room[4]), levelId: room[2], name: room[0] };
  };
  const a = place(fromName), b = place(toName);
  const t = performance.now();
  const route = await findRoute(nav, a, b);
  console.log(`${a.name} -> ${b.name}: ${Math.round(route.length)} m, ~${Math.round(route.seconds / 60)} min, ${route.expanded} cells expanded in ${Math.round(performance.now() - t)} ms`);
  for (const line of describe(route, (id) => id.replace('ETH.', ''))) console.log('  ' + line);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => (console.error(e.message), process.exit(1)));
