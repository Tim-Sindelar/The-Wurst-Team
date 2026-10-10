import { Icon, type IconName } from '../../components/Icon';
import geometry from './geometry';
import type { LayoutItem, RoomGeometry } from './models';
const seatFill: Record<string, string> = {
  free: 'fill-seat-free',
  reserved: 'fill-seat-reserved',
  occupied: 'fill-seat-occupied',
  on_break: 'fill-seat-break',
  break: 'fill-seat-break',
  claimable: 'fill-seat-bookable',
  bookable: 'fill-seat-bookable',
  unavailable: 'fill-seat-occupied opacity-50',
  unknown: 'fill-seat-occupied opacity-50',
};
const path = (points: [number, number][]) =>
  points.map((p, i) => (i ? 'L' : 'M') + p.join(' ')).join('') + 'Z';
function FeatureBadge({
  icon,
  title,
  x,
  y,
}: {
  icon: IconName;
  title: string;
  x: number;
  y: number;
}) {
  return (
    <g transform={'translate(' + x + ' ' + y + ')'}>
      <title>{title}</title>
      <circle r={9} className="fill-surface stroke-border-strong" />
      <g transform="translate(-6 -6)">
        <Icon name={icon} size="xs" />
      </g>
    </g>
  );
}
export function RoomScene({
  room,
  objects,
  selected,
  editor = false,
  scale = 1,
  onSelect,
}: {
  room: RoomGeometry;
  objects: LayoutItem[];
  selected?: string | null;
  editor?: boolean;
  scale?: number;
  onSelect?: (id: string) => void;
}) {
  return (
    <>
      <path
        d={path(room.points)}
        className="fill-surface stroke-border-strong"
        strokeWidth={2}
      />
      {[
        ...objects.filter((o) => o.type !== 'seat'),
        ...objects.filter((o) => o.type === 'seat'),
      ].map((o) => {
        const w = o.width,
          h = o.height,
          angle = o.angle || 0,
          labelY =
            o.shape === 'l'
              ? -h / 2 + 16
              : o.shape === 'curved'
                ? (-w * 0.175 * (o.curvature ?? 60)) / 100
                : 0;
        const rowSlots =
          o.type === 'row'
            ? geometry.slots({ ...o, x: 0, y: 0, angle: 0 })
            : [];
        return (
          <g
            key={o.id}
            data-item={o.id}
            className="admin-scene-item"
            role="button"
            tabIndex={0}
            aria-label={
              (o.type === 'seat'
                ? 'Seat ' + String(o.number).padStart(2, '0')
                : o.label || o.type) +
              (o.type === 'seat'
                ? ', ' + (o.state || 'unknown').replace('_', ' ')
                : '')
            }
            aria-pressed={selected === o.id}
            onClick={() => onSelect?.(o.id)}
            onKeyDown={(e) => {
              if (['Enter', ' '].includes(e.key)) {
                e.preventDefault();
                onSelect?.(o.id);
              }
            }}
            transform={
              'translate(' + o.x + ' ' + o.y + ') rotate(' + angle + ')'
            }
          >
            {o.type === 'table' && (
              <>
                {o.shape === 'round' ? (
                  <circle r={w / 2} className="admin-scene-table" />
                ) : o.shape === 'l' ? (
                  <path
                    d={
                      'M' +
                      -w / 2 +
                      ' ' +
                      -h / 2 +
                      'H' +
                      w / 2 +
                      'V' +
                      (-h / 2 + 32) +
                      'H' +
                      (-w / 2 + 32) +
                      'V' +
                      h / 2 +
                      'H' +
                      -w / 2 +
                      'Z'
                    }
                    className="admin-scene-table"
                  />
                ) : o.shape === 'curved' ? (
                  <path
                    d={path(geometry.curveOutline(o))}
                    className="admin-scene-table"
                  />
                ) : (
                  <rect
                    x={-w / 2}
                    y={-h / 2}
                    width={w}
                    height={h}
                    rx={5}
                    className="admin-scene-table"
                  />
                )}
                <text
                  y={labelY}
                  transform={'rotate(' + -angle + ' 0 ' + labelY + ')'}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-text-muted text-label"
                >
                  {o.label}
                </text>
                {editor &&
                  geometry
                    .slots(o)
                    .filter(
                      (s) =>
                        !objects.some(
                          (i) =>
                            i.type === 'seat' &&
                            i.tableId === o.id &&
                            i.slot === s.slot,
                        ),
                    )
                    .filter((s) =>
                      geometry.valid(room, {
                        ...s,
                        id: 'slot',
                        type: 'seat',
                        width: 32,
                        height: 36,
                      }),
                    )
                    .filter(
                      (s) =>
                        !objects.some(
                          (other) =>
                            ['table', 'seat'].includes(other.type) &&
                            geometry.overlaps(
                              {
                                ...s,
                                id: 'slot',
                                type: 'seat',
                                width: 32,
                                height: 36,
                              },
                              other,
                            ),
                        ),
                    )
                    .map((s) => {
                      const a = (-angle * Math.PI) / 180,
                        dx = s.x - o.x,
                        dy = s.y - o.y;
                      return (
                        <circle
                          key={s.slot}
                          cx={dx * Math.cos(a) - dy * Math.sin(a)}
                          cy={dx * Math.sin(a) + dy * Math.cos(a)}
                          r={4}
                          className="fill-camera-fg stroke-border-strong"
                        >
                          <title>Seat position</title>
                        </circle>
                      );
                    })}
              </>
            )}
            {o.type === 'row' && (
              <>
                {Array.from({ length: o.rows || 1 }, (_, row) => {
                  const points = rowSlots.filter((s) =>
                    s.slot.startsWith('row' + row + ':'),
                  );
                  const radius =
                    Math.max(
                      o.radius || 0,
                      56 /
                        (2 *
                          Math.sin(
                            ((o.sweep || 0) * Math.PI) /
                              180 /
                              Math.max(1, (o.count || 1) - 1) /
                              2,
                          )),
                    ) +
                    row * 64;
                  const d =
                    points.length > 1 && o.sweep
                      ? 'M' +
                        points[0].x +
                        ' ' +
                        points[0].y +
                        'A' +
                        radius +
                        ' ' +
                        radius +
                        ' 0 0 0 ' +
                        points.at(-1)!.x +
                        ' ' +
                        points.at(-1)!.y
                      : points
                          .map((p, i) => (i ? 'L' : 'M') + p.x + ' ' + p.y)
                          .join('');
                  return (
                    <g key={row}>
                      <path
                        d={d}
                        stroke="transparent"
                        strokeWidth={28}
                        fill="none"
                      />
                      <path
                        d={d}
                        className="stroke-border-strong"
                        fill="none"
                      />
                    </g>
                  );
                })}
                <g
                  transform={
                    'translate(0 ' +
                    (Math.min(...rowSlots.map((s) => s.y)) - 40 / scale) +
                    ') rotate(' +
                    -angle +
                    ') scale(' +
                    1 / scale +
                    ')'
                  }
                >
                  <rect
                    x={-48}
                    y={-22}
                    width={96}
                    height={44}
                    rx={5}
                    className="fill-surface-2 stroke-border-strong"
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-text text-small"
                  >
                    {o.label}
                  </text>
                </g>
              </>
            )}
            {o.type === 'seat' && (
              <>
                <rect
                  x={-16}
                  y={-18}
                  width={32}
                  height={36}
                  rx={5}
                  className={seatFill[o.state || 'unknown'] || seatFill.unknown}
                />
                <g transform={'rotate(' + -angle + ')'}>
                  <text
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-on-seat text-label font-bold"
                  >
                    {String(o.number).padStart(2, '0')}
                  </text>
                  {(o.badges || []).map((b, i) => (
                    <FeatureBadge
                      key={b}
                      icon={b === 'quiet' ? 'moon' : b}
                      title={geometry.BADGES[b]}
                      x={(i - ((o.badges?.length || 1) - 1) / 2) * 19}
                      y={23}
                    />
                  ))}
                  {['on_break', 'break'].includes(o.state || '') && (
                    <FeatureBadge
                      icon="coffee"
                      title="On break"
                      x={17}
                      y={-18}
                    />
                  )}
                  {['claimable', 'bookable'].includes(o.state || '') && (
                    <FeatureBadge
                      icon="clock"
                      title="Bookable later"
                      x={17}
                      y={-18}
                    />
                  )}
                </g>
              </>
            )}
            {o.type === 'window' && (
              <>
                <path
                  d={'M' + -w / 2 + ' 0H' + w / 2}
                  className="stroke-surface"
                  strokeWidth={16}
                />
                <path
                  d={'M' + -w / 2 + ' 0H' + w / 2}
                  className="stroke-accent"
                  strokeWidth={5}
                />
              </>
            )}
            {o.type === 'door' && (
              <>
                <path
                  d={'M' + -w / 2 + ' 0H' + w / 2}
                  className="stroke-surface"
                  strokeWidth={16}
                />
                <path
                  d={
                    'M' +
                    -w / 2 +
                    ' 0V' +
                    w +
                    'M' +
                    -w / 2 +
                    ' ' +
                    w +
                    'A' +
                    w +
                    ' ' +
                    w +
                    ' 0 0 0 ' +
                    w / 2 +
                    ' 0'
                  }
                  className="stroke-border-strong"
                  fill="none"
                />
              </>
            )}
          </g>
        );
      })}
      {editor &&
        objects
          .filter(
            (o) =>
              o.id === selected && ['table', 'window', 'door'].includes(o.type),
          )
          .flatMap((o) =>
            (o.type === 'table'
              ? ['nw', 'ne', 'se', 'sw']
              : ['start', 'end']
            ).map((handle) => {
              const p = geometry.handlePoint(o, handle);
              return (
                <g
                  key={handle}
                  data-item={o.id}
                  data-resize={handle}
                  transform={
                    'translate(' +
                    p.x +
                    ' ' +
                    p.y +
                    ') scale(' +
                    1 / scale +
                    ')'
                  }
                  className="cursor-nwse-resize"
                >
                  <circle r={18} fill="transparent" />
                  <path
                    d="M-7 7Q7 7 7-7"
                    className="stroke-text"
                    strokeWidth={4}
                    strokeLinecap="round"
                    fill="none"
                  />
                </g>
              );
            }),
          )}
    </>
  );
}
