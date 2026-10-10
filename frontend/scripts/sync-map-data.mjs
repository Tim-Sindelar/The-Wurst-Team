// Copies the campus map configuration from the experimental map editor
// (occupancy-map-preview/data) into map-data/, the configuration this app uses.
// Run after changing the map there: npm run map:sync
import { copyFile } from 'node:fs/promises';

const FILES = [
  'generated.json',
  'overrides.json',
  'map-style.json',
  'navigation.json',
];
const from = new URL('../../occupancy-map-preview/data/', import.meta.url);
const to = new URL('../map-data/', import.meta.url);

for (const file of FILES) {
  await copyFile(new URL(file, from), new URL(file, to));
  console.log(`map-data/${file} updated`);
}
