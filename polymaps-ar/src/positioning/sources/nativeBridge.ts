/**
 * Beacon readings pushed into the page by a native wrapper (WebView / Capacitor shell).
 *
 * Browsers on iOS cannot scan Bluetooth, and Android Chrome only behind a flag, so a thin native
 * shell around this web app is the robust path on phones. The shell ranges iBeacons with the
 * PolyMaps UUID (iOS: CLLocationManager.startRangingBeacons(satisfying:), Android: a BLE scan with
 * an Apple manufacturer-data filter) and calls, about once per second,
 *
 *   window.polymapsBeacons([{ uuid, major, minor, rssi }, ...])
 *
 * or posts { type: 'polymaps-beacons', beacons: [...] } with window.postMessage.
 */
import type { BeaconReading, BeaconSource } from '../types';

type RawBeacon = { uuid: string; major: number; minor: number; rssi: number; timestamp?: number };

declare global {
  interface Window {
    polymapsBeacons?: (beacons: RawBeacon[]) => void;
    /** Set by the native shell so the page can tell the bridge is there. */
    polymapsNativeBridge?: boolean;
    /** The Android shell's JavaScript interface (polymaps-ar/android). */
    PolymapsAndroid?: {
      status(): string;
      /** Android app >= 0.2: SuperPoint on the phone (see src/vps/superpoint.ts). */
      superPoint?(id: number, grayBase64: string, width: number, height: number, maxKeypoints: number): void;
    };
    polymapsSuperPoint?: (id: number, result: string | null, backend: string, ms: number, error: string | null) => void;
  }
}

export function nativeBridgeAvailable(): boolean {
  return typeof window !== 'undefined' && (window.polymapsNativeBridge === true || window.PolymapsAndroid !== undefined);
}

export class NativeBridgeBeaconSource implements BeaconSource {
  readonly name = 'Native bridge';
  private onMessage: ((e: MessageEvent) => void) | null = null;

  async start(onReadings: (readings: BeaconReading[]) => void): Promise<void> {
    const push = (beacons: RawBeacon[]) => {
      const now = Date.now();
      // iOS reports rssi 0 for beacons it ranged but did not hear in the last second.
      onReadings(beacons.filter((b) => b.rssi < 0).map((b) => ({ ...b, uuid: b.uuid.toUpperCase(), timestamp: b.timestamp ?? now })));
    };
    window.polymapsBeacons = push;
    this.onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'polymaps-beacons' && Array.isArray(e.data.beacons)) push(e.data.beacons);
    };
    window.addEventListener('message', this.onMessage);
  }

  stop(): void {
    delete window.polymapsBeacons;
    if (this.onMessage) window.removeEventListener('message', this.onMessage);
    this.onMessage = null;
  }
}
