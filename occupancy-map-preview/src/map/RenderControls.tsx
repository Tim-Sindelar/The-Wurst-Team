import { useState, type ReactNode } from 'react';
import { DEFAULT_MINIMAL, PART_LABELS, ROOM_KINDS, type MinimalStyle, type OccupancyStyle, type PartKey, type PartStyle, type RenderMode } from './minimalStyle';
import { ROOM_STATUS_LABELS, ROOM_STATUSES } from '../domain/ethRooms';
import type { Theme } from './FloorLayer';

interface Props {
  theme: Theme;
  mode: RenderMode;
  onModeChange: (mode: RenderMode) => void;
  /** Minimal style of the current theme. */
  style: MinimalStyle;
  onStyleChange: (style: MinimalStyle) => void;
  /** Both themes' styles equal the saved standard (data/map-style.json). */
  isStandard: boolean;
  /** Saves both themes as the standard. */
  onSaveStandard: () => Promise<void>;
  /** Drops this theme's changes, back to the standard. */
  onReset: () => void;
  /** Live room mode is on: its colors can be styled, in either render mode. */
  occupancyActive: boolean;
  /** More controls in the bar (the live room mode switch) and the panel they open, if any. */
  extraBar?: ReactNode;
  extraPanel?: ReactNode;
}

/** Map overlay: Detailed/Minimal switch and, in minimal mode, the style editor. */
export function RenderControls({ theme, mode, onModeChange, style, onStyleChange, isStandard, onSaveStandard, onReset, occupancyActive, extraBar, extraPanel }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const save = async () => {
    setSaveState('saving');
    try {
      await onSaveStandard();
      setSaveState('saved');
    } catch (err) {
      console.error(err);
      setSaveState('error');
    }
  };

  const set = (patch: Partial<MinimalStyle>) => onStyleChange({ ...style, ...patch });
  const setPart = (key: PartKey, patch: Partial<PartStyle>) =>
    set({ parts: { ...style.parts, [key]: { ...style.parts[key], ...patch } } });
  const setOcc = (patch: Partial<OccupancyStyle>) => set({ occupancy: { ...style.occupancy, ...patch } });
  const minimal = mode === 'minimal';
  const styleable = minimal || occupancyActive;
  const toggleKind = (kind: (typeof ROOM_KINDS)[number]) =>
    set({ roomKinds: style.roomKinds.includes(kind) ? style.roomKinds.filter((k) => k !== kind) : [...style.roomKinds, kind] });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(style, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="render-controls">
      <div className="render-bar">
        <div className="mode-toggle" role="radiogroup" aria-label="Render mode">
          <button role="radio" aria-checked={mode === 'detailed'} onClick={() => onModeChange('detailed')}>
            Detailed
          </button>
          <button role="radio" aria-checked={mode === 'minimal'} onClick={() => onModeChange('minimal')}>
            Minimal
          </button>
        </div>
        {extraBar}
        {styleable && (
          <button className={`btn-ghost style-toggle${open ? ' is-active' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
            Style
          </button>
        )}
      </div>

      {extraPanel}

      {styleable && open && (
        <div className="style-panel">
          {occupancyActive && (
            <section>
              <h3>Room occupancy <span className="muted">({theme} theme)</span></h3>
              {ROOM_STATUSES.map((st) => (
                <div key={st} className="part-head">
                  <span className="check">
                    <i className="status-dot" style={{ background: style.occupancy[st] }} />
                    {ROOM_STATUS_LABELS[st]}
                  </span>
                  <input type="color" aria-label={`${ROOM_STATUS_LABELS[st]} color`} value={style.occupancy[st]} onChange={(e) => setOcc({ [st]: e.target.value })} />
                </div>
              ))}
              <div className="part-head">
                <span className="check">Selected room outline</span>
                <input type="color" aria-label="Selected room outline color" value={style.occupancy.selected} onChange={(e) => setOcc({ selected: e.target.value })} />
              </div>
              <Slider label="Fill" min={0} max={1} step={0.05} value={style.occupancy.fill} onChange={(v) => setOcc({ fill: v })} />
              <Slider label="Outline" min={0} max={4} step={0.1} value={style.occupancy.weight} unit="px" onChange={(v) => setOcc({ weight: v })} />
            </section>
          )}
          {minimal && (
            <>
              <section>
                <h3>Basemap</h3>
                <label className="check">
                  <input type="checkbox" checked={style.basemapLabels} onChange={(e) => set({ basemapLabels: e.target.checked })} />
                  Names, numbers &amp; icons
                </label>
                <Slider label="Opacity" min={0} max={1} step={0.05} value={style.basemapOpacity} onChange={(v) => set({ basemapOpacity: v })} />
              </section>

              <section>
                <h3>Outlines <span className="muted">({theme} theme)</span></h3>
                {(Object.keys(PART_LABELS) as PartKey[]).map((key) => {
                  const p = style.parts[key];
                  return (
                    <div key={key} className={`part${p.show ? '' : ' is-off'}`}>
                      <div className="part-head">
                        <label className="check">
                          <input type="checkbox" checked={p.show} onChange={(e) => setPart(key, { show: e.target.checked })} />
                          {PART_LABELS[key].label}
                        </label>
                        <span className="part-colors">
                          <input
                            type="color"
                            title="Line color"
                            aria-label={`${PART_LABELS[key].label} line color`}
                            value={p.color}
                            disabled={key === 'workspaces' && style.occupancyColors}
                            onChange={(e) => setPart(key, { color: e.target.value })}
                          />
                          {PART_LABELS[key].polygon && (
                            <input
                              type="color"
                              className="fill-color"
                              title="Fill color"
                              aria-label={`${PART_LABELS[key].label} fill color`}
                              value={p.fillColor}
                              disabled={key === 'workspaces' && style.occupancyColors}
                              onChange={(e) => setPart(key, { fillColor: e.target.value })}
                            />
                          )}
                        </span>
                      </div>
                      {p.show && (
                        <div className="part-body">
                          <Slider label="Width" min={0.2} max={6} step={0.1} value={p.weight} unit="px" onChange={(v) => setPart(key, { weight: v })} />
                          <Slider label="Opacity" min={0} max={1} step={0.05} value={p.opacity} onChange={(v) => setPart(key, { opacity: v })} />
                          {PART_LABELS[key].polygon && (
                            <Slider label="Fill" min={0} max={1} step={0.05} value={p.fill} onChange={(v) => setPart(key, { fill: v })} />
                          )}
                          {key === 'workspaces' && (
                            <label className="check">
                              <input type="checkbox" checked={style.occupancyColors} onChange={(e) => set({ occupancyColors: e.target.checked })} />
                              Color by occupancy
                            </label>
                          )}
                          {key === 'rooms' && (
                            <div className="kind-chips">
                              {ROOM_KINDS.map((k) => (
                                <button key={k} className={`chip${style.roomKinds.includes(k) ? ' is-active' : ''}`} onClick={() => toggleKind(k)}>
                                  {k}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>

              <section>
                <h3>Workspace highlight <span className="muted">({theme} theme)</span></h3>
                <Slider label="Extra width" min={0} max={6} step={0.25} value={style.highlightWidth} unit="px" onChange={(v) => set({ highlightWidth: v })} />
                <Slider label="Extra fill" min={0} max={0.8} step={0.05} value={style.highlightFill} onChange={(v) => set({ highlightFill: v })} />
                <div className="part-head">
                  <label className="check">
                    <input type="checkbox" checked={style.highlightCustomColor} onChange={(e) => set({ highlightCustomColor: e.target.checked })} />
                    Custom color
                  </label>
                  <input
                    type="color"
                    aria-label="Highlight color"
                    value={style.highlightColor}
                    disabled={!style.highlightCustomColor}
                    onChange={(e) => set({ highlightColor: e.target.value })}
                  />
                </div>
              </section>

              <section>
                <h3>Geometry</h3>
                <Slider label="Corner radius" min={0} max={3} step={0.1} value={style.cornerRadius} unit="m" onChange={(v) => set({ cornerRadius: v })} />
                <Slider label="Simplify" min={0} max={5} step={0.25} value={style.simplify} unit="px" onChange={(v) => set({ simplify: v })} />
                <Slider label="Merge parallel" min={0} max={1.5} step={0.05} value={style.mergeDistance} unit="m" onChange={(v) => set({ mergeDistance: v })} />
                {style.mergeDistance > 0 && (
                  <Slider label="Parallel within" min={0} max={20} step={0.5} value={style.mergeAngle} unit="°" onChange={(v) => set({ mergeAngle: v })} />
                )}
                <Slider label="Min. size" min={0} max={10} step={0.25} value={style.minSize} unit="m" onChange={(v) => set({ minSize: v })} />
                <label className="check">
                  <input type="checkbox" checked={style.roundJoins} onChange={(e) => set({ roundJoins: e.target.checked })} />
                  Round line joins
                </label>
              </section>
            </>
          )}

          <div className={`style-status${saveState === 'error' ? ' is-error' : ''}`}>
            {saveState === 'saving'
              ? 'Saving…'
              : saveState === 'error'
                ? 'Save failed, see the console'
                : isStandard
                  ? saveState === 'saved'
                    ? 'Saved to data/map-style.json'
                    : 'Matches the standard style'
                  : 'Changes differ from the standard (kept in this browser)'}
          </div>
          <div className="style-actions">
            <button className="btn-ghost" title="Restore the built-in defaults for this theme" onClick={() => onStyleChange(structuredClone(DEFAULT_MINIMAL[theme]))}>
              Built-in
            </button>
            <button className="btn-ghost" title="Discard this theme's changes and go back to the standard" disabled={isStandard} onClick={onReset}>
              Reset
            </button>
            <button className="btn-ghost" onClick={copy}>
              {copied ? 'Copied' : 'Copy JSON'}
            </button>
            <button className="btn" title="Write both themes to data/map-style.json as the default for everyone" disabled={isStandard || saveState === 'saving'} onClick={save}>
              Save as standard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Slider(props: { label: string; min: number; max: number; step: number; value: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <output>
        {+props.value.toFixed(2)}
        {props.unit}
      </output>
    </label>
  );
}
