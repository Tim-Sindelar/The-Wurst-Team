import type { ReactNode } from 'react';
import { isZoneActive, NAV_ZONE_DEFAULTS, type NavigationConfig, type NavZone, type NavZoneKind } from '../domain/navigation';
import { newId } from '../domain/operations';
import type { FloorIndex } from '../floors/floorData';

interface Props {
  config: NavigationConfig;
  /** Current map zoom, to show whether a zone is clickable right now. */
  zoom: number;
  floorIndex: FloorIndex | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Whether the selected zone's click area is being drawn. */
  editingOutline: boolean;
  onToggleOutline: () => void;
  onChange: (config: NavigationConfig) => void;
  onPreview: (zone: NavZone) => void;
}

const KIND_LABELS: Record<NavZoneKind, string> = { area: 'Areas', building: 'Buildings' };

/** Admin settings for click-to-zoom: zones, their click areas, target zoom and active zoom range. */
export function NavigationAdmin(p: Props) {
  const { config, zoom, selectedId } = p;
  const zone = config.zones.find((z) => z.id === selectedId) ?? null;
  const update = (id: string, patch: Partial<NavZone>) =>
    p.onChange({ zones: config.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) });

  const add = (kind: NavZoneKind) => {
    const z: NavZone = {
      id: newId('nav'),
      name: kind === 'area' ? 'New area' : 'New building',
      kind,
      outline: null,
      ...NAV_ZONE_DEFAULTS[kind],
    };
    p.onChange({ zones: [...config.zones, z] });
    p.onSelect(z.id);
  };

  const zoomInput = (value: number, onChange: (v: number) => void) => (
    <span className="zoom-input">
      <input
        type="number"
        min={0}
        max={24}
        step={0.5}
        value={value}
        onChange={(e) => {
          const v = e.target.valueAsNumber;
          if (Number.isFinite(v)) onChange(Math.min(24, Math.max(0, v)));
        }}
      />
      <button className="btn-ghost" title="Use the current map zoom" onClick={() => onChange(Math.round(zoom * 2) / 2)}>
        current
      </button>
    </span>
  );

  return (
    <section className="panel-section">
      <div className="section-head">
        <h2>Quick navigation</h2>
        <div className="icon-actions">
          <button className="btn" onClick={() => add('area')}>
            + Area
          </button>
          <button className="btn" onClick={() => add('building')}>
            + Building
          </button>
        </div>
      </div>
      <p className="note">
        Clicking inside a zone zooms the map there, as long as the map's zoom is in the zone's range. Buildings take
        precedence over areas. Current zoom: <strong>{zoom.toFixed(1)}</strong>.
      </p>

      {(['area', 'building'] as const).map((kind) => {
        const list = config.zones.filter((z) => z.kind === kind);
        return (
          <div key={kind}>
            <div className="section-head sub">
              <h3>
                {KIND_LABELS[kind]} ({list.length})
              </h3>
            </div>
            <ul className="table-grid">
              {list.map((z) => (
                <li key={z.id}>
                  <button
                    className={`chip${z.id === selectedId ? ' is-active' : ''}`}
                    title={isZoneActive(z, zoom) ? 'Clickable at the current zoom' : undefined}
                    onClick={() => p.onSelect(z.id === selectedId ? null : z.id)}
                  >
                    {isZoneActive(z, zoom) ? '● ' : '○ '}
                    {z.name || '(unnamed)'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {zone && (
        <div className="form nav-zone-form">
          <div className="section-head sub">
            <h3>{zone.kind === 'area' ? 'Area' : 'Building'} settings</h3>
            <button
              className="btn-danger"
              onClick={() => {
                if (!confirm(`Delete "${zone.name}"?`)) return;
                p.onChange({ zones: config.zones.filter((z) => z.id !== zone.id) });
                p.onSelect(null);
              }}
            >
              Delete
            </button>
          </div>
          <Field label="Name">
            <input value={zone.name} onChange={(e) => update(zone.id, { name: e.target.value })} />
          </Field>
          <Field label="Click zooms to level">{zoomInput(zone.zoom, (v) => update(zone.id, { zoom: v }))}</Field>
          <Field label="Clickable only when zoomed out further than (zoom <)">
            {zoomInput(zone.activeBelowZoom, (v) => update(zone.id, { activeBelowZoom: v }))}
          </Field>
          {zone.kind === 'building' && (
            <Field label="…and not further out than (zoom ≥)">
              {zoomInput(zone.activeFromZoom ?? 0, (v) => update(zone.id, { activeFromZoom: v }))}
            </Field>
          )}
          <p className="note">
            {!zone.outline
              ? 'Draw a click area to activate this zone.'
              : zone.activeFromZoom !== null && zone.activeFromZoom >= zone.activeBelowZoom
                ? 'The zoom range is empty: this zone is never clickable.'
                : isZoneActive(zone, zoom)
                  ? 'Clickable at the current zoom.'
                  : 'Not clickable at the current zoom.'}
          </p>

          <div className="section-head sub">
            <h3>Click area</h3>
            <div className="icon-actions">
              {zone.outline && !p.editingOutline && (
                <button className="btn-danger" onClick={() => confirm('Remove this click area?') && update(zone.id, { outline: null })}>
                  Clear
                </button>
              )}
              <button className={p.editingOutline ? 'btn is-active' : 'btn'} onClick={p.onToggleOutline}>
                {p.editingOutline ? 'Done' : zone.outline ? 'Edit area' : 'Draw area'}
              </button>
            </div>
          </div>
          {p.editingOutline ? (
            <p className="note">
              Use the toolbar at the top left of the map to draw or edit the polygon(s). Changes save automatically.
            </p>
          ) : (
            <p className="note">{zone.outline ? `${zone.outline.coordinates.length} part(s)` : 'No click area yet.'}</p>
          )}
          {zone.kind === 'building' && p.floorIndex && !p.editingOutline && (
            <select
              className="full"
              value=""
              aria-label="Use a building footprint as click area"
              onChange={(e) => {
                const f = p.floorIndex!.facilities.find((x) => x.id === e.target.value);
                if (!f) return;
                const named = zone.name === 'New building' || !zone.name;
                update(zone.id, { outline: f.outline, ...(named ? { name: f.name } : {}) });
              }}
            >
              <option value="" disabled>
                Use a building footprint…
              </option>
              {[...p.floorIndex.facilities]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          )}
          {zone.outline && (
            <button className="btn-ghost" onClick={() => p.onPreview(zone)}>
              Try it: zoom there
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
