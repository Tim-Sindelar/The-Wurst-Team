import { duration } from '../domain/ethRooms';
import type { DatasetMeta } from './types';
import type { DatasetSettings, DatasetState } from './useDatasets';

/** "Campus data" switch for the render bar on the map. */
export function DatasetButton({ open, onOpen, active, busy }: { open: boolean; onOpen: (open: boolean) => void; active: number; busy: boolean }) {
  return (
    <button
      className={`style-toggle${open ? ' is-active' : ''}`}
      aria-expanded={open}
      title="Mensas, transport, sport, weather and more on the map"
      onClick={() => onOpen(!open)}
    >
      <i className={`live-dot${busy ? ' is-busy' : ''}`} style={active ? { background: 'var(--free)' } : undefined} /> Campus data{active ? ` (${active})` : ''} ▾
    </button>
  );
}

/** Which datasets are shown, their freshness and errors, and the amenity categories. */
export function DatasetPanel({ metas, listError, settings, onChange, states, onReload }: {
  metas: DatasetMeta[] | null;
  listError: string | null;
  settings: DatasetSettings;
  onChange: (s: DatasetSettings) => void;
  states: Record<string, DatasetState>;
  onReload: (id: string) => void;
}) {
  const toggle = (id: string, on: boolean) =>
    onChange({ ...settings, enabled: on ? [...settings.enabled, id] : settings.enabled.filter((x) => x !== id) });
  return (
    <div className="style-panel dataset-panel">
      <section>
        <h3>Campus data</h3>
        {listError && <p className="note error-text">{listError}</p>}
        {!metas && !listError && <p className="note">Loading…</p>}
        {metas?.map((meta) => {
          const on = settings.enabled.includes(meta.id);
          const state = states[meta.id];
          return (
            <div key={meta.id} className={`part${on ? '' : ' is-off'}`}>
              <label className="check feature" title={meta.description}>
                <input type="checkbox" checked={on} onChange={(e) => toggle(meta.id, e.target.checked)} />
                <span>
                  <span className="ds-swatch" style={{ background: meta.color }}>{meta.glyph}</span> {meta.title}
                  <span className="muted"> · {meta.description}</span>
                </span>
              </label>
              {on && <DatasetStatus meta={meta} state={state} onReload={() => onReload(meta.id)} />}
              {on && meta.id === 'amenities' && state?.response && (
                <CategoryChips
                  items={state.response.document.items}
                  hidden={settings.hiddenCategories[meta.id] ?? []}
                  onChange={(hidden) => onChange({ ...settings, hiddenCategories: { ...settings.hiddenCategories, [meta.id]: hidden } })}
                />
              )}
            </div>
          );
        })}
        <p className="note">Live data is fetched by datasets/&lt;name&gt;/fetch.py on the dev server and cached in data/cache/datasets.</p>
      </section>
    </div>
  );
}

function DatasetStatus({ meta, state, onReload }: { meta: DatasetMeta; state: DatasetState | undefined; onReload: () => void }) {
  const r = state?.response;
  const errors = r?.document.errors ?? [];
  return (
    <div className="part-body">
      {!r && (state?.error ? <p className="note error-text">{state.error}</p> : <p className="note">Loading…</p>)}
      {r && (
        <p className="note">
          {r.document.items.length} on the map · updated {duration(Math.max(0, Math.round(r.ageSeconds / 60)))} ago
          {r.refreshing ? ' · updating…' : ''}{' '}
          <button className="btn-ghost btn-small" onClick={onReload} disabled={r.refreshing || state?.loading} title={`Fetch again (normally every ${duration(Math.round(meta.ttlSeconds / 60))})`}>
            ↻
          </button>
        </p>
      )}
      {(errors.length > 0 || r?.lastError) && (
        <details>
          <summary className="note error-text">
            {r?.lastError ? 'Last update failed' : `${errors.length} live source${errors.length > 1 ? 's' : ''} unavailable`}
          </summary>
          <p className="note unmatched">{[r?.lastError, ...errors].filter(Boolean).join('\n')}</p>
        </details>
      )}
    </div>
  );
}

function CategoryChips({ items, hidden, onChange }: { items: { category: string; details: unknown }[]; hidden: string[]; onChange: (hidden: string[]) => void }) {
  const counts = new Map<string, { label: string; n: number }>();
  for (const it of items) {
    const label = (it.details as { categoryLabel?: string }).categoryLabel ?? it.category;
    const c = counts.get(it.category) ?? { label, n: 0 };
    c.n++;
    counts.set(it.category, c);
  }
  return (
    <div className="kind-chips">
      {[...counts].map(([cat, { label, n }]) => {
        const on = !hidden.includes(cat);
        return (
          <button key={cat} className={`chip${on ? ' is-active' : ''}`} aria-pressed={on}
            onClick={() => onChange(on ? [...hidden, cat] : hidden.filter((h) => h !== cat))}>
            {label} {n}
          </button>
        );
      })}
    </div>
  );
}
