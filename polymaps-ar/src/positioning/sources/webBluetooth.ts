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

/** What the last scan received, to tell "Chrome delivers nothing" from "our filter drops it". */
export const webBluetoothStats = {
  adverts: 0,
  apple: 0,
  ibeacon: 0,
  matched: 0,
  devices: new Set<string>(),
  companies: new Map<number, number>(),
  otherUuids: new Set<string>(),
  reset() {
    this.adverts = this.apple = this.ibeacon = this.matched = 0;
    this.devices.clear();
    this.companies.clear();
    this.otherUuids.clear();
  },
};
(globalThis as { __ble?: typeof webBluetoothStats }).__ble = webBluetoothStats;

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
      const ev = e as AdvertisementEvent & { device?: { id: string } };
      const st = webBluetoothStats;
      st.adverts++;
      if (ev.device) st.devices.add(ev.device.id);
      ev.manufacturerData?.forEach((_, id) => st.companies.set(id, (st.companies.get(id) ?? 0) + 1));
      const data = ev.manufacturerData?.get(APPLE_COMPANY_ID);
      if (!data || ev.rssi === undefined) return;
      st.apple++;
      const frame = parseIBeacon(data);
      if (!frame) return;
      st.ibeacon++;
      if (!this.uuids.has(frame.uuid)) return void st.otherUuids.add(frame.uuid);
      st.matched++;
      onReadings([{ ...frame, rssi: ev.rssi, timestamp: Date.now() }]);
    };
    webBluetoothStats.reset();
    bt.addEventListener('advertisementreceived', this.listener);
    try {
      this.scan = await bt.requestLEScan({ acceptAllAdvertisements: true, keepRepeatedDevices: true });
    } catch (e) {
      // Chrome's "Bluetooth adapter not available" usually means a missing Android permission, not missing hardware.
      if (e instanceof DOMException && e.name === 'NotFoundError')
        throw new Error(
          `${e.message}. Turn on Bluetooth and Location, and give Chrome the "Nearby devices" and "Location" permissions (Android Settings > Apps > Chrome > Permissions).`,
        );
      throw e;
    }
  }

  stop(): void {
    this.scan?.stop();
    this.scan = null;
    if (this.listener) bluetooth()?.removeEventListener('advertisementreceived', this.listener);
    this.listener = null;
  }
}
