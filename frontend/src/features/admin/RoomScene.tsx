import type { KeyboardEvent } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import geometry from './geometry';
import type { LayoutItem, RoomGeometry } from './models';
const seatFill: Record<string, string> = {
  free: 'fill-seat-free stroke-seat-free',
  reserved: 'fill-seat-reserved stroke-seat-reserved',
  occupied: 'fill-seat-occupied stroke-seat-occupied',
  on_break: 'fill-seat-break stroke-seat-break',
  break: 'fill-seat-break stroke-seat-break',
  claimable: 'fill-seat-bookable stroke-seat-bookable',
  bookable: 'fill-seat-bookable stroke-seat-bookable',
  unavailable: 'fill-seat-occupied opacity-50',
  unknown: 'fill-seat-occupied opacity-50',
};
const path = (points: [number, number][]) =>
  points.map((p, i) => (i ? 'L' : 'M') + p.join(' ')).join('') + 'Z';
export function FeatureBadge({
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
  onResize,
  onRotate,
  resizeHandles = editor,
  interactive = true,
}: {
  room: RoomGeometry;
  objects: LayoutItem[];
  selected?: string | null;
  editor?: boolean;
  scale?: number;
  onSelect?: (id: string) => void;
  resizeHandles?: boolean;
  onResize?: (id: string, handle: string, dx: number, dy: number) => void;
  onRotate?: (id: string, delta: number) => void;
  /** False draws the room as a picture: no item is focusable or clickable. */
  interactive?: boolean;
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
            {...(interactive && {
              'data-item': o.id,
              className: 'admin-scene-item',
              role: 'button',
              tabIndex: 0,
              'aria-label':
                (o.type === 'seat'
                  ? 'Seat ' + String(o.number).padStart(2, '0')
                  : o.label || o.type) +
                (o.type === 'seat'
                  ? ', ' + (o.state || 'unknown').replace('_', ' ')
                  : ''),
              'aria-pressed': selected === o.id,
              onClick: () => onSelect?.(o.id),
              onKeyDown: (e: KeyboardEvent) => {
                if (['Enter', ' '].includes(e.key)) {
                  e.preventDefault();
                  onSelect?.(o.id);
                }
              },
            })}
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
                  className="fill-text-muted text-small font-bold"
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
                  strokeWidth={2}
                  className={seatFill[o.state || 'unknown'] || seatFill.unknown}
                />
                <g transform={'rotate(' + -angle + ')'}>
                  <text
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className={
                      ['occupied', 'unavailable', 'unknown'].includes(
                        o.state || 'unknown',
                      )
                        ? 'fill-on-seat-muted text-small font-bold'
                        : 'fill-on-seat text-small font-bold'
                    }
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
                  stroke="transparent"
                  strokeWidth={24}
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
                  strokeWidth={6}
                />
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
            {selected === o.id && o.type !== 'row' && (
              <rect
                x={-w / 2 - 4}
                y={['window', 'door'].includes(o.type) ? -8 : -h / 2 - 4}
                width={w + 8}
                height={
                  o.type === 'door' ? w + 16 : o.type === 'window' ? 16 : h + 8
                }
                rx={7}
                className="admin-scene-selection"
                fill="none"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
          </g>
        );
      })}
      {resizeHandles &&
        objects
          .filter(
            (o) =>
              o.id === selected && ['table', 'window', 'door'].includes(o.type),
          )
          .flatMap((o) =>
            (o.type === 'table' ? ['nw', 'ne', 'sw', 'se'] : ['w', 'e']).map(
              (handle) => {
                const p = geometry.handlePoint(o, handle);
                const sx = handle.includes('w') ? -1 : 1;
                const sy = handle.includes('n')
                  ? -1
                  : handle.includes('s')
                    ? 1
                    : 0;
                const notch =
                  o.type === 'table'
                    ? 'M-12 4H-2Q4 4 4 -2V-12'
                    : 'M-3 -9Q6 -9 6 0Q6 9 -3 9';
                return (
                  <g
                    key={handle}
                    data-item={o.id}
                    data-resize={handle}
                    role="button"
                    tabIndex={0}
                    aria-label={'Resize ' + (o.label || o.type) + ' ' + handle}
                    transform={
                      'translate(' +
                      p.x +
                      ' ' +
                      p.y +
                      ') rotate(' +
                      o.angle +
                      ')'
                    }
                    className="admin-resize-handle"
                    onKeyDown={(e) => {
                      const delta: Record<string, [number, number]> = {
                        ArrowLeft: [-16, 0],
                        ArrowRight: [16, 0],
                        ArrowUp: [0, -16],
                        ArrowDown: [0, 16],
                      };
                      if (delta[e.key]) {
                        e.preventDefault();
                        e.stopPropagation();
                        onResize?.(o.id, handle, ...delta[e.key]);
                      }
                    }}
                  >
                    <circle r={22 / scale} fill="transparent" />
                    <g
                      transform={
                        'scale(' + sx / scale + ' ' + (sy || 1) / scale + ')'
                      }
                      pointerEvents="none"
                    >
                      <path
                        d={notch}
                        className="stroke-surface"
                        strokeWidth={7}
                        strokeLinecap="round"
                        fill="none"
                      />
                      <path
                        d={notch}
                        className="admin-resize-grip stroke-accent"
                        strokeWidth={3}
                        strokeLinecap="round"
                        fill="none"
                      />
                    </g>
                  </g>
                );
              },
            ),
          )}
      {resizeHandles &&
        objects
          .filter((o) => o.id === selected && o.type === 'table')
          .flatMap((o) =>
            ['nw', 'ne', 'sw', 'se'].map((handle) => {
              const p = geometry.handlePoint(o, handle);
              const sx = handle.includes('w') ? -1 : 1;
              const sy = handle.includes('n') ? -1 : 1;
              return (
                <g
                  key={'rotate-' + handle}
                  data-item={o.id}
                  data-rotate={handle}
                  role="button"
                  tabIndex={0}
                  aria-label={'Rotate ' + (o.label || 'table') + ' ' + handle}
                  className="admin-rotate-handle"
                  transform={
                    'translate(' +
                    p.x +
                    ' ' +
                    p.y +
                    ') rotate(' +
                    o.angle +
                    ') translate(' +
                    (sx * 32) / scale +
                    ' ' +
                    (sy * 32) / scale +
                    ') scale(' +
                    1 / scale +
                    ')'
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                      e.preventDefault();
                      e.stopPropagation();
                      onRotate?.(
                        o.id,
                        (e.key === 'ArrowLeft' ? -1 : 1) *
                          (e.shiftKey ? 90 : 15),
                      );
                    }
                  }}
                >
                  <title>
                    Drag to rotate; hold Shift for 15° steps. Left and right
                    arrow keys rotate 15°, or 90° with Shift.
                  </title>
                  <circle r={22} fill="transparent" />
                  <g
                    className="admin-rotate-grip"
                    transform={'scale(' + sx + ' ' + sy + ')'}
                    pointerEvents="none"
                  >
                    <path
                      d="M-8 8A16 16 0 0 1 8 -8M-12 2L-8 8L-2 4M2 -12L8 -8L4 -2"
                      fill="none"
                      className="stroke-surface"
                      strokeWidth={5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M-8 8A16 16 0 0 1 8 -8M-12 2L-8 8L-2 4M2 -12L8 -8L4 -2"
                      fill="none"
                      className="stroke-accent"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </g>
                </g>
              );
            }),
          )}
    </>
  );
}
