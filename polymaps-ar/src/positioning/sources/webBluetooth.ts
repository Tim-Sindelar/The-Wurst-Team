/**
 * iBeacon scanning in the browser via the Web Bluetooth Scanning API (navigator.bluetooth.requestLEScan).
 *
 * Availability (2026): Chrome on Android with chrome://flags/#enable-experimental-web-platform-features,
 * over HTTPS, after a user gesture. Not available on iOS (no Web Bluetooth); use the native bridge
 * there (see nativeBridge.ts), where CoreLocation can range the PolyMaps UUID directly.
 */
import { APPLE_COMPANY_ID, parseIBeacon } from '../ibeacon';
import type { BeaconReading, BeaconSource } from '../types';

interface AdvertisementEvent extends Event {
  rssi?: number;
  manufacturerData: Map<number, DataView>;
}

interface LEScan {
  active: boolean;
  stop(): void;
}

interface ScanningBluetooth extends EventTarget {
  requestLEScan(options: { acceptAllAdvertisements?: boolean; keepRepeatedDevices?: boolean; filters?: unknown[] }): Promise<LEScan>;
}

function bluetooth(): ScanningBluetooth | null {
  const bt = (navigator as Navigator & { bluetooth?: Partial<ScanningBluetooth> }).bluetooth;
  return bt && typeof bt.requestLEScan === 'function' ? (bt as ScanningBluetooth) : null;
}

export function webBluetoothScanningSupported(): boolean {
  return bluetooth() !== null;
}

export class WebBluetoothBeaconSource implements BeaconSource {
  readonly name = 'Web Bluetooth';
  private scan: LEScan | null = null;
  private listener: ((e: Event) => void) | null = null;
  private readonly uuids: Set<string>;

  constructor(uuids: string[]) {
    this.uuids = new Set(uuids.map((u) => u.toUpperCase()));
  }

  async start(onReadings: (readings: BeaconReading[]) => void): Promise<void> {
    const bt = bluetooth();
    if (!bt) throw new Error('Web Bluetooth scanning is not available (Chrome Android with experimental web platform features)');
    this.listener = (e: Event) => {
      const ev = e as AdvertisementEvent;
      const data = ev.manufacturerData?.get(APPLE_COMPANY_ID);
      if (!data || ev.rssi === undefined) return;
      const frame = parseIBeacon(data);
      if (!frame || !this.uuids.has(frame.uuid)) return;
      onReadings([{ ...frame, rssi: ev.rssi, timestamp: Date.now() }]);
    };
    bt.addEventListener('advertisementreceived', this.listener);
    this.scan = await bt.requestLEScan({ acceptAllAdvertisements: true, keepRepeatedDevices: true });
  }

  stop(): void {
    this.scan?.stop();
    this.scan = null;
    if (this.listener) bluetooth()?.removeEventListener('advertisementreceived', this.listener);
    this.listener = null;
  }
}
