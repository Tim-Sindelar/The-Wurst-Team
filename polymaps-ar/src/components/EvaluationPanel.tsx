/**
 * Field accuracy test: stand somewhere, tap that spot on the map, press Measure. Every BLE and GPS
 * fix during the window is logged against that truth; both are scored by the same evaluate().
 */
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { evaluate, type GroundTruth } from '../evaluation/metrics';
import { newSession, parseSession, sessionSamples, type Session } from '../evaluation/session';
import type { PositionFix } from '../positioning/types';
import { ErrorCdf } from './ErrorCdf';

interface Props {
  session: Session;
  setSession: Dispatch<SetStateAction<Session>>;
  truth: GroundTruth | null;
  /** Called when a measurement starts / stops, so the app logs fixes into the session. */
  recording: boolean;
  setRecording: (r: boolean) => void;
  latest: { ble: PositionFix | null; gps: PositionFix | null };
}

const DURATION_S = 30;
const LABELS: Record<string, string> = { ble: 'BLE (PolyMaps beacons)', gps: 'GPS' };

export function EvaluationPanel({ session, setSession, truth, recording, setRecording, latest }: Props) {
  const [remaining, setRemaining] = useState(0);
  const [duration, setDuration] = useState(DURATION_S);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => clearInterval(t);
  }, [recording]);
  useEffect(() => {
    if (recording && remaining <= 0) stop();
  });

  const start = () => {
    if (!truth) return;
    const now = Date.now();
    setSession((s) => ({ ...s, checkpoints: [...s.checkpoints, { id: s.checkpoints.length + 1, truth, start: now, end: now + duration * 1000 }] }));
    setRemaining(duration);
    setRecording(true);
  };
  const stop = () => {
    const now = Date.now();
    setSession((s) => {
      const cps = s.checkpoints.slice();
      const last = cps[cps.length - 1];
      if (last) cps[cps.length - 1] = { ...last, end: Math.min(last.end, now) };
      return { ...s, checkpoints: cps };
    });
    setRecording(false);
  };

  const stats = useMemo(() => evaluate(sessionSamples(session, ['ble', 'gps'])), [session]);
  const f = (v: number | null | undefined, d = 1) => (v == null || Number.isNaN(v) ? '–' : v.toFixed(d));
  const pct = (v: number | null) => (v === null || Number.isNaN(v) ? '–' : `${Math.round(v * 100)} %`);

  const download = () => {
    const blob = new Blob([JSON.stringify(session, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `polymaps-accuracy-${session.startedAt.slice(0, 19).replace(/:/g, '')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const upload = async (file: File) => {
    try {
      setSession(parseSession(await file.text()));
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <div className="panel">
      <h2>Accuracy test: BLE vs GPS</h2>
      <ol className="steps">
        <li>Start BLE and GPS (top bar). Wait until both show a fix.</li>
        <li>Stand still at a spot you can find on the plan (door, pillar, stair). Pick its floor and tap it on the map.</li>
        <li>Press <b>Measure</b> and hold the phone normally for {duration} s. Repeat at many spots.</li>
      </ol>
      <div className="row">
        <button className="primary" disabled={!truth || recording} onClick={start}>
          {recording ? `Measuring… ${remaining} s` : truth ? `Measure checkpoint ${session.checkpoints.length + 1}` : 'Tap your position on the map first'}
        </button>
        {recording && <button onClick={stop}>Stop</button>}
        <label className="inline">
          <input type="number" min={5} max={300} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /> s
        </label>
      </div>
      <div className="live">
        {(['ble', 'gps'] as const).map((m) => (
          <span key={m} className={`pill ${m}`}>
            {LABELS[m]}: {latest[m] ? `±${f(latest[m]!.accuracy)} m${latest[m]!.levelId ? ` · ${latest[m]!.levelId!.replace('ETH.', '')}` : ''}` : 'no fix'}
          </span>
        ))}
      </div>

      <div className="table-wrap">
      <table className="stats">
        <caption>
          {session.checkpoints.length} checkpoints, sampled once per second after a 3 s warm-up. Errors in metres.
        </caption>
        <thead>
          <tr>
            <th>Method</th><th>Samples</th><th>Fix available</th><th>Median</th><th>Mean</th><th>90 %</th><th>Max</th><th>Right floor</th><th>Error ≤ reported ±</th>
          </tr>
        </thead>
        <tbody>
          {stats.length === 0 && (
            <tr><td colSpan={9}>No measurements yet.</td></tr>
          )}
          {stats.map((s) => (
            <tr key={s.method}>
              <th>{LABELS[s.method] ?? s.method}</th>
              <td>{s.samples}</td>
              <td>{pct(s.availability)}</td>
              <td>{f(s.median)}</td>
              <td>{f(s.mean)}</td>
              <td>{f(s.p90)}</td>
              <td>{f(s.max)}</td>
              <td>{s.floorRate === null ? 'no floor' : pct(s.floorRate)}</td>
              <td>{pct(s.withinReportedAccuracy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <ErrorCdf stats={stats} />

      <label className="block">
        Notes (phone, building, conditions)
        <input value={session.description} onChange={(e) => {
            const description = e.target.value;
            setSession((s) => ({ ...s, description }));
          }} placeholder="Pixel 8, HG E floor, busy" />
      </label>
      <div className="row">
        <button onClick={download} disabled={session.checkpoints.length === 0}>Export session (JSON)</button>
        <label className="button">
          Import session
          <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
        <button
          onClick={() => confirm('Discard all measurements?') && setSession(newSession(session.description))}
          disabled={session.checkpoints.length === 0 || recording}
        >
          Reset
        </button>
      </div>
      <p className="muted">
        Exported sessions can be scored offline with the same code: <code>npm run evaluate -- session.json</code>.
      </p>
    </div>
  );
}
