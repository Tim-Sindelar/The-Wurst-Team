import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RadioMap, type RadioMapIndex } from '../src/positioning/radioMap';

const IPS_DIR = fileURLToPath(new URL('../public/ips/', import.meta.url));

/** The radio map written by scraper/extract_ips.py, read from disk (Node). */
export function loadRadioMapFromDisk(dir = IPS_DIR): RadioMap {
  const index = JSON.parse(readFileSync(`${dir}index.json`, 'utf-8')) as RadioMapIndex;
  return new RadioMap(index, async (key) => {
    const b = readFileSync(`${dir}tiles/${key}.bin`);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  });
}
