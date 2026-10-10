/* Demo room photos. The real ones are ETH's room photos, served by the backend at
   `/api/v1/map/eth/file?id=<id>` once spaces carry an ETH file id. Until then every
   space gets one of a few stock pictures, picked by a hash of its id so it is stable. */
const demoPhotoCount = 6;

export function roomPhotoUrl(spaceId: string): string {
  let hash = 0;
  for (const char of spaceId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `/demo-rooms/${(hash % demoPhotoCount) + 1}.jpg`;
}
