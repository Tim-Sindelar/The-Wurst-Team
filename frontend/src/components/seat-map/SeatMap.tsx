import { ActionIcon, Popover } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { seatStateName, stateVar, type SeatState } from '../../domain/seat';
import { roomGeometry, roomTables, type MapSeat } from '../../domain/room';
import { Icon } from '../Icon';
import { SectionLabel } from '../SectionLabel';
import { createPanZoom, type PanZoom } from './panZoom';
import { SeatMarker } from './SeatMarker';

const keyStates: SeatState[] = [
  'free',
  'reserved',
  'occupied',
  'break',
  'bookable',
];

type SeatMapProps = {
  seats: MapSeat[];
  /** The selected seat, or null when nothing is selected. */
  selected: string | null;
  onSelect: (seatId: string) => void;
  /** The empty map was tapped. */
  onDeselect: () => void;
  /** Height in px of what covers the bottom of the map (the seat sheet). */
  bottomInset?: number;
};

/* Interactive room map: top-down floor plan with colour-coded seats.
   Pan, pinch and scroll to zoom; the colour key opens from the (i) button. */
export function SeatMap({
  seats,
  selected,
  onSelect,
  onDeselect,
  bottomInset = 0,
}: SeatMapProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const panZoomRef = useRef<PanZoom | null>(null);
  const onSelectRef = useRef(onSelect);
  const onDeselectRef = useRef(onDeselect);
  const insetRef = useRef(bottomInset);
  const [ready, setReady] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onDeselectRef.current = onDeselect;
    insetRef.current = bottomInset;
  });

  useEffect(() => {
    const viewport = viewportRef.current;
    const world = worldRef.current;
    if (!viewport || !world) return;
    const panZoom = createPanZoom({
      viewport,
      world,
      onDraw: () => {},
      onSeatTap: (seat) => onSelectRef.current(String(seat.dataset.seatId)),
      onMapPress: () => setKeyOpen(false),
      onMapTap: () => onDeselectRef.current(),
    });
    panZoomRef.current = panZoom;
    setReady(true);
    return () => panZoom.destroy();
  }, []);

  /* A new selection (tap, keyboard or "Choose any free seat") is brought into view. */
  const shownSelection = useRef(selected);
  useEffect(() => {
    if (shownSelection.current === selected) return;
    shownSelection.current = selected;
    const seat = seats.find((item) => item.id === selected);
    if (seat) panZoomRef.current?.centerOn(seat.x, seat.y, insetRef.current);
  }, [selected, seats]);

  return (
    <div
      ref={viewportRef}
      className="relative size-full cursor-grab touch-none overflow-hidden bg-canvas select-none"
      tabIndex={0}
      role="region"
      aria-label="Interactive room map. Arrow keys move, plus and minus zoom, Home fits the room."
    >
      <div
        ref={worldRef}
        className={`absolute top-0 left-0 h-190 w-160 origin-top-left ${ready ? 'visible' : 'invisible'}`}
      >
        <svg
          className="pointer-events-none absolute inset-0 size-full"
          viewBox={`0 0 ${roomGeometry.width} ${roomGeometry.height}`}
          aria-hidden="true"
          focusable="false"
        >
          <path className="fill-surface" d={roomGeometry.fill} />
          <path
            className="fill-none stroke-border-strong stroke-2"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            d={roomGeometry.walls}
          />
          <path
            className="fill-none stroke-accent stroke-6"
            vectorEffect="non-scaling-stroke"
            d={roomGeometry.windows}
          />
          <path
            className="fill-none stroke-border-strong stroke-1"
            vectorEffect="non-scaling-stroke"
            d={roomGeometry.door}
          />
          {roomTables.map((table) => (
            <g key={`${table.x}-${table.y}`}>
              <rect
                className="fill-surface-2 stroke-border-strong stroke-1"
                x={table.x}
                y={table.y}
                width={table.width}
                height={table.height}
                rx={5}
              />
              {table.label && (
                <text
                  className="fill-text-muted text-label font-semibold"
                  x={table.x + table.width / 2}
                  y={table.y + 22}
                  textAnchor="middle"
                >
                  {table.label}
                </text>
              )}
            </g>
          ))}
        </svg>
        {seats.map((seat) => (
          <SeatMarker
            key={seat.id}
            id={seat.id}
            label={seat.label}
            state={seat.state}
            x={seat.x}
            y={seat.y}
            selected={seat.id === selected}
            onSelect={() => onSelect(seat.id)}
          />
        ))}
      </div>

      <div className="absolute top-3 left-3 z-1" data-map-info>
        <Popover
          opened={keyOpen}
          onChange={setKeyOpen}
          position="bottom-start"
          offset={8}
          withinPortal
          returnFocus
        >
          <Popover.Target>
            <ActionIcon
              variant="map"
              className="border border-border-strong bg-surface shadow-card aria-expanded:text-accent"
              aria-label="Seat colour information"
              onClick={() => setKeyOpen((open) => !open)}
            >
              <Icon name="info" size="sm" />
            </ActionIcon>
          </Popover.Target>
          <Popover.Dropdown className="w-55">
            <SectionLabel as="h3">Seat colours</SectionLabel>
            <ul className="grid gap-2">
              {keyStates.map((state) => (
                <li key={state} className="flex items-center gap-3 text-small">
                  <span
                    className={`size-3 flex-none rounded-control bg-(--state) ${stateVar[state]}`}
                    aria-hidden="true"
                  />
                  {seatStateName[state]}
                </li>
              ))}
            </ul>
          </Popover.Dropdown>
        </Popover>
      </div>
    </div>
  );
}
