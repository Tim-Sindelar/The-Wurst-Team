import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArView } from './ar/ArView';
import { MapCanvas, type MapMarker } from './components/MapCanvas';
import { EvaluationPanel } from './components/EvaluationPanel';
import type { GroundTruth } from './evaluation/metrics';
import { newSession, type Session } from './evaluation/session';
import { FloorPlans } from './floors/floorPlans';
import type { LngLat } from './geo';
import { BlePositioningEngine } from './positioning/engine';
import { RadioMap } from './positioning/radioMap';
import { GeolocationSource } from './positioning/sources/geolocation';
import { NativeBridgeBeaconSource, nativeBridgeAvailable } from './positioning/sources/nativeBridge';
import { SimulatedBeaconSource, type SimulatedTruth } from './positioning/sources/simulated';
import { SimulatedGpsSource } from './positioning/sources/simulatedGps';
import { WebBluetoothBeaconSource, webBluetoothScanningSupported } from './positioning/sources/webBluetooth';
import type { FixSource, PositionFix } from './positioning/types';

type Tab = 'map' | 'test' | 'ar';
type BleMode = 'off' | 'web-bluetooth' | 'native' | 'simulation';
type GpsMode = 'off' | 'device' | 'simulation';

const DEFAULT_LEVEL = 'ETH.HG.E';

/** ?sim=lng,lat,LEVEL_ID starts both simulations with the phone at that spot (demos, tests). */
function initialSim(): { lng: number; lat: number; levelId: string } | null {
  const [lng, lat, levelId] = (new URLSearchParams(location.search).get('sim') ?? '').split(',');
  return levelId && Number.isFinite(+lng) && Number.isFinite(+lat) ? { lng: +lng, lat: +lat, levelId } : null;
}

function initialTab(): Tab {
  const t = new URLSearchParams(location.search).get('tab');
  return t === 'test' || t === 'ar' ? t : 'map';
}

export function App() {
  const [radioMap, setRadioMap] = useState<RadioMap | null>(null);
  const [floors, setFloors] = useState<FloorPlans | null>(null);
  const [loadError, setLoadError] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [startSim] = useState(initialSim);
  const [bleMode, setBleMode] = useState<BleMode>(startSim ? 'simulation' : 'off');
  const [gpsMode, setGpsMode] = useState<GpsMode>(startSim ? 'simulation' : 'off');
  const [bleFix, setBleFix] = useState<PositionFix | null>(null);
  const [gpsFix, setGpsFix] = useState<PositionFix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [levelId, setLevelId] = useState(startSim?.levelId ?? DEFAULT_LEVEL);
  const [followFix, setFollowFix] = useState(true);
  const [simTruth, setSimTruth] = useState<SimulatedTruth | null>(null);
  const simTruthRef = useRef(simTruth);
  simTruthRef.current = simTruth;
  const [truth, setTruth] = useState<GroundTruth | null>(null);
  const [session, setSession] = useState<Session>(() => newSession());
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(false);
  recordingRef.current = recording;
  const engineRef = useRef<BlePositioningEngine | null>(null);
  const simRef = useRef<SimulatedBeaconSource | null>(null);

  useEffect(() => {
    if (startSim && radioMap && radioMap.levelIndexOf(startSim.levelId) >= 0) {
      setSimTruth({ lng: startSim.lng, lat: startSim.lat, levelIndex: radioMap.levelIndexOf(startSim.levelId) });
    }
  }, [startSim, radioMap]);

  useEffect(() => {
    RadioMap.load('ips').then(setRadioMap, (e: Error) => setLoadError((l) => [...l, e.message]));
    FloorPlans.load('floors').then(setFloors, (e: Error) => setLoadError((l) => [...l, e.message]));
  }, []);

  const logFix = useCallback((fix: PositionFix) => {
    if (recordingRef.current) setSession((s) => ({ ...s, fixes: [...s.fixes, fix] }));
  }, []);

  // BLE engine lifecycle.
  useEffect(() => {
    if (bleMode === 'off' || !radioMap) return;
    let source;
    if (bleMode === 'web-bluetooth') source = new WebBluetoothBeaconSource(radioMap.index.uuid);
    else if (bleMode === 'native') source = new NativeBridgeBeaconSource();
    else {
      source = simRef.current = new SimulatedBeaconSource(radioMap, simTruthRef.current);
    }
    const engine = new BlePositioningEngine(radioMap, source);
    engineRef.current = engine;
    setError(null);
    engine
      .start(
        (fix) => {
          setBleFix(fix);
          logFix(fix);
        },
        (e) => setError(e.message),
      )
      .catch((e: Error) => {
        setError(e.message);
        setBleMode('off');
      });
    return () => {
      engine.stop();
      engineRef.current = null;
      simRef.current = null;
      setBleFix(null);
    };
  }, [bleMode, radioMap, logFix]);

  // Keep the simulator at the simulated truth.
  useEffect(() => {
    if (simRef.current) simRef.current.truth = simTruth;
  }, [simTruth]);

  // GPS lifecycle.
  useEffect(() => {
    if (gpsMode === 'off') return;
    const source: FixSource =
      gpsMode === 'device'
        ? new GeolocationSource(floors && radioMap ? { facilities: floors.index.facilities, levelInfo: radioMap.index.levelInfo } : null)
        : new SimulatedGpsSource(() => simTruthRef.current);
    source
      .start(
        (fix) => {
          setGpsFix(fix);
          logFix(fix);
        },
        (e) => setError(e.message),
      )
      .catch((e: Error) => {
        setError(e.message);
        setGpsMode('off');
      });
    return () => {
      source.stop();
      setGpsFix(null);
    };
  }, [gpsMode, floors, radioMap, logFix]);

  // Follow the BLE floor.
  useEffect(() => {
    if (followFix && bleFix?.levelId && bleFix.levelId !== levelId) setLevelId(bleFix.levelId);
  }, [bleFix, followFix, levelId]);

  const level = floors?.level(levelId);
  const facilityLevels = useMemo(() => (floors && level ? floors.levelsOf(level.facilityId) : []), [floors, level]);
  const hasFingerprints = radioMap ? radioMap.levelIndexOf(levelId) >= 0 : false;

  const pick = (p: LngLat) => {
    if (tab === 'test') setTruth({ ...p, levelId });
    if (bleMode === 'simulation' || tab === 'map') {
      if (radioMap && hasFingerprints) setSimTruth({ ...p, levelIndex: radioMap.levelIndexOf(levelId) });
    }
  };

  const markers: MapMarker[] = [
    ...session.checkpoints.filter((c) => c.truth.levelId === levelId).map((c) => ({ ...c.truth, kind: 'checkpoint' as const, label: String(c.id) })),
    ...(tab === 'test' && truth && truth.levelId === levelId ? [{ ...truth, kind: 'truth' as const, label: 'you' }] : []),
    ...(bleMode === 'simulation' && simTruth && tab !== 'test' && radioMap?.levelId(simTruth.levelIndex) === levelId
      ? [{ ...simTruth, kind: 'truth' as const, label: 'simulated phone' }]
      : []),
  ];
  const fixes = [bleFix, gpsFix].filter((f): f is PositionFix => f !== null);
  const arPose = bleFix ?? (gpsFix ? { ...gpsFix, levelId: gpsFix.levelId ?? levelId } : null);

  const bleOptions: { value: BleMode; label: string; disabled?: boolean }[] = [
    { value: 'off', label: 'BLE off' },
    { value: 'web-bluetooth', label: `Web Bluetooth${webBluetoothScanningSupported() ? '' : ' (unsupported)'}`, disabled: !webBluetoothScanningSupported() },
    { value: 'native', label: `Native bridge${nativeBridgeAvailable() ? '' : ' (not detected)'}` },
    { value: 'simulation', label: 'BLE simulation' },
  ];

  return (
    <div className={`app tab-${tab}`}>
      <header className="topbar">
        <strong className="brand">PolyMaps AR</strong>
        <nav>
          {(['map', 'test', 'ar'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'map' ? 'Map' : t === 'test' ? 'Accuracy test' : 'AR'}
            </button>
          ))}
        </nav>
        <div className="sources">
          <select value={bleMode} onChange={(e) => setBleMode(e.target.value as BleMode)} aria-label="BLE source">
            {bleOptions.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
            ))}
          </select>
          <select value={gpsMode} onChange={(e) => setGpsMode(e.target.value as GpsMode)} aria-label="GPS source">
            <option value="off">GPS off</option>
            <option value="device">GPS (device)</option>
            <option value="simulation">GPS simulation</option>
          </select>
        </div>
      </header>
      {loadError.map((e) => (
        <div key={e} className="banner error">{e}</div>
      ))}
      {error && <div className="banner error" onClick={() => setError(null)}>{error}</div>}
      {(bleMode === 'simulation' || gpsMode === 'simulation') && (
        <div className="banner sim">
          Simulation: {tab === 'test' ? 'the simulated phone stands where you tap.' : 'tap the map to move the simulated phone.'} Simulated numbers are not field results.
          {bleMode === 'simulation' && !simTruth && ' Tap a corridor on a floor with beacon coverage to start.'}
        </div>
      )}

      {tab === 'ar' ? (
        <ArView floors={floors} pose={arPose} fallbackLabel={bleMode === 'simulation' ? 'simulation' : undefined} />
      ) : (
        <main className="main">
          <section className="map-side">
            {floors && level ? (
              <>
                <div className="levelbar">
                  <span className="facility">{floors.facility(level.facilityId)?.name ?? level.facilityId}</span>
                  <div className="levels">
                    {facilityLevels.map((l) => (
                      <button
                        key={l.id}
                        className={`${l.id === levelId ? 'active' : ''} ${radioMap && radioMap.levelIndexOf(l.id) < 0 ? 'nocov' : ''}`}
                        title={radioMap && radioMap.levelIndexOf(l.id) < 0 ? 'no beacon coverage' : l.name}
                        onClick={() => {
                          setFollowFix(false);
                          setLevelId(l.id);
                        }}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                  <BuildingSearch floors={floors} onSelect={(id) => (setFollowFix(false), setLevelId(id))} />
                  <label className="inline">
                    <input type="checkbox" checked={followFix} onChange={(e) => setFollowFix(e.target.checked)} /> follow
                  </label>
                </div>
                <MapCanvas
                  floors={floors}
                  levelId={levelId}
                  fixes={fixes}
                  markers={markers}
                  focus={followFix && bleFix ? bleFix : null}
                  onPick={pick}
                />
                {!hasFingerprints && radioMap && <div className="map-note">No beacon coverage on this floor.</div>}
              </>
            ) : (
              <div className="loading">Loading floor plans…</div>
            )}
          </section>
          <aside className="side">
            {tab === 'test' ? (
              <EvaluationPanel
                session={session}
                setSession={setSession}
                truth={truth}
                recording={recording}
                setRecording={setRecording}
                latest={{ ble: bleFix, gps: gpsFix }}
              />
            ) : (
              <StatusPanel radioMap={radioMap} bleFix={bleFix} gpsFix={gpsFix} engine={engineRef.current} />
            )}
          </aside>
        </main>
      )}
    </div>
  );
}

function BuildingSearch({ floors, onSelect }: { floors: FloorPlans; onSelect: (levelId: string) => void }) {
  const facilities = useMemo(
    () => [...new Set(floors.index.levels.map((l) => l.facilityId))].sort(),
    [floors],
  );
  return (
    <select
      aria-label="Building"
      value=""
      onChange={(e) => {
        const levels = floors.levelsOf(e.target.value);
        const ground = levels.find((l) => l.floor === 0) ?? levels[0];
        if (ground) onSelect(ground.id);
      }}
    >
      <option value="">Building…</option>
      {facilities.map((f) => (
        <option key={f} value={f}>{f.replace('ETH.', '')}</option>
      ))}
    </select>
  );
}

function StatusPanel({ radioMap, bleFix, gpsFix, engine }: { radioMap: RadioMap | null; bleFix: PositionFix | null; gpsFix: PositionFix | null; engine: BlePositioningEngine | null }) {
  const row = (label: string, fix: PositionFix | null) => (
    <tr>
      <th>{label}</th>
      <td>{fix ? `${fix.lat.toFixed(6)}, ${fix.lng.toFixed(6)}` : '–'}</td>
      <td>{fix ? `±${fix.accuracy.toFixed(1)} m` : ''}</td>
      <td>{fix?.levelId?.replace('ETH.', '') ?? (fix ? 'no floor' : '')}</td>
    </tr>
  );
  return (
    <div className="panel">
      <h2>Position</h2>
      <table className="stats">
        <tbody>
          {row('BLE', bleFix)}
          {row('GPS', gpsFix)}
        </tbody>
      </table>
      {engine && (
        <p className="muted">
          Beacons in scan: {engine.lastObservations.length} · device RSSI offset {engine.deviceOffset.toFixed(1)} dB
          {engine.lastEstimate ? ` · floor confidence ${Math.round(engine.lastEstimate.levelConfidence * 100)} %` : ''}
        </p>
      )}
      <h3>How the BLE position is computed</h3>
      <p>
        PolyMaps positions phones with ~12 000 Bluetooth iBeacons (UUID <code>{radioMap?.index.uuid[0] ?? '…'}</code>). Its radio map, the
        reference RSSI of every beacon on a 0.75 m grid along all corridors, is public in the ETH ArcGIS IPS service. This app matches what
        the phone hears against that map (Gaussian likelihood per beacon, best points averaged), calibrates the phone's RSSI offset
        on the fly and smooths the track with a Kalman filter.
      </p>
      <p className="muted">
        {radioMap ? `${radioMap.beaconCount} beacons, ${radioMap.index.levels.length} floors with coverage. Source: ${radioMap.index.source}` : 'Loading radio map…'}
      </p>
      <h3>Scanning beacons on a phone</h3>
      <ul>
        <li><b>Android Chrome:</b> enable <code>chrome://flags/#enable-experimental-web-platform-features</code>, open this page over HTTPS, choose Web Bluetooth.</li>
        <li><b>iOS / any phone:</b> browsers can't scan; a small native shell can range the UUID and feed this page (Native bridge, see README).</li>
        <li><b>No phone:</b> BLE simulation draws scans from the radio map with realistic noise.</li>
      </ul>
    </div>
  );
}
