import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type PointerEvent as ReactPointerEvent,
  type ChangeEvent,
} from 'react';
import { useBeforeUnload, useBlocker, useOutletContext } from 'react-router';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  NativeSelect,
  NumberInput,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import * as api from '../../api/generated';
import { DecisionSheet } from '../../components/DecisionSheet';
import { Icon } from '../../components/Icon';
import { AdminFeedback } from './AdminFeedback';
import { AdminNewSpacePage } from './AdminNewSpacePage';
import { RoomScene } from './RoomScene';
import geometry from './geometry';
import { documentFor, readLayout } from './layoutDocument';
import type {
  Feature,
  LayoutDocument,
  LayoutItem,
  RoomGeometry,
  Tool,
} from './models';
import { adminHeaders, useAdminAction } from './useAdminAction';
type Drag = {
  kind: 'item' | 'resize' | 'pan';
  id?: string;
  handle?: string;
  before: LayoutItem[];
  base: LayoutItem[];
  start: { x: number; y: number };
  last: { x: number; y: number };
  x: number;
  y: number;
  view: { x: number; y: number; width: number; height: number };
  screen: { x: number; y: number };
  scale: number;
};
const tools: [Tool, string, string][] = [
  ['select', 'Select', 'Esc'],
  ['table', 'Rectangle', 'T'],
  ['round', 'Round', 'O'],
  ['l', 'L shape', 'L'],
  ['curved', 'Curved', 'U'],
  ['seat', 'Seat', 'S'],
  ['window', 'Window', 'W'],
  ['door', 'Door', 'D'],
  ['row', 'Seat rows', 'A'],
  ['outlet', 'Power outlet', 'P'],
  ['monitor', 'Monitor', 'E'],
  ['quiet', 'Quiet area', 'Q'],
];
export function AdminLayoutPage() {
  const space = useOutletContext<api.AdminSpaceOverview>();
  let document;
  try {
    document = readLayout(space.layout);
  } catch (error) {
    return (
      <Alert variant="danger">
        {error instanceof Error ? error.message : 'Invalid saved layout'}
      </Alert>
    );
  }
  if (!document)
    return (
      <>
        <Alert>
          Link a campus room border before placing furniture. Existing seats
          will remain available for assignment.
        </Alert>
        <AdminNewSpacePage
          existingSpaceId={space.id}
          existingMapRoomId={space.map_room_id}
        />
      </>
    );
  return (
    <LayoutEditor
      key={JSON.stringify(space.layout)}
      document={document}
      space={space}
    />
  );
}
function LayoutEditor({
  document,
  space,
}: {
  document: LayoutDocument;
  space: api.AdminSpaceOverview;
}) {
  const room: RoomGeometry = document.room,
    action = useAdminAction();
  const [objects, setObjects] = useState(() =>
      geometry.normalize(room, document.objects),
    ),
    [selected, setSelected] = useState<string | null>(null),
    [tool, setTool] = useState<Tool>('select'),
    [menu, setMenu] = useState<'table' | 'features' | null>(null),
    [message, setMessage] = useState(''),
    [clear, setClear] = useState(false),
    [view, setView] = useState({
      x: 0,
      y: 0,
      width: room.width,
      height: room.height,
    });
  const initial = JSON.stringify(geometry.normalize(room, document.objects));
  const dirty = JSON.stringify(objects) !== initial;
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const [canvasSize, setCanvasSize] = useState({
    width: room.width,
    height: room.height,
  });
  useEffect(() => {
    const target = svg.current;
    if (!target) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setCanvasSize({ width: rect.width, height: rect.height });
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  const objectsRef = useRef(objects),
    viewRef = useRef(view),
    svg = useRef<SVGSVGElement>(null),
    drag = useRef<Drag | null>(null),
    undo = useRef<LayoutItem[][]>([]),
    redo = useRef<LayoutItem[][]>([]),
    editing = useRef<LayoutItem[] | null>(null);
  const blocker = useBlocker(dirty && !action.busy);
  useBeforeUnload(
    useCallback(
      (e) => {
        if (dirty) {
          e.preventDefault();
          e.returnValue = '';
        }
      },
      [dirty],
    ),
  );
  function record(before: LayoutItem[]) {
    if (JSON.stringify(before) !== JSON.stringify(objectsRef.current)) {
      undo.current.push(geometry.clone(before));
      redo.current = [];
      setHistory({ undo: undo.current.length, redo: redo.current.length });
    }
  }
  function change(next: LayoutItem[], checkpoint = true) {
    const before = objectsRef.current;
    objectsRef.current = next;
    setHistory({ undo: undo.current.length, redo: redo.current.length });
    if (checkpoint) record(before);
    setObjects(next);
  }
  function setViewport(next: typeof view) {
    viewRef.current = next;
    setView(next);
  }
  function onFeatureChange(event: ChangeEvent<HTMLInputElement>) {
    if (selected)
      change(
        geometry.toggleBadge(
          objectsRef.current,
          selected,
          event.currentTarget.value as Feature,
        ),
      );
  }
  function edit(patch: Partial<LayoutItem>) {
    if (!selected) return;
    try {
      change(
        geometry.update(room, objectsRef.current, selected, patch),
        !editing.current,
      );
      setMessage('Updated.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Change blocked');
    }
  }
  function point(e: { clientX: number; clientY: number }) {
    const p = svg.current!.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    return p.matrixTransform(svg.current!.getScreenCTM()!.inverse());
  }
  function begin(e: ReactPointerEvent<SVGSVGElement>) {
    if (![0, 1].includes(e.button) || space.is_archived) return;
    e.preventDefault();
    svg.current!.focus();
    svg.current!.setPointerCapture(e.pointerId);
    const p = point(e),
      target = (e.target as Element).closest('[data-item]'),
      id = target?.getAttribute('data-item'),
      resize = (e.target as Element)
        .closest('[data-resize]')
        ?.getAttribute('data-resize');
    const current = objectsRef.current;
    if (e.button === 1) {
      drag.current = {
        kind: 'pan',
        before: current,
        base: current,
        start: p,
        last: p,
        x: 0,
        y: 0,
        view: viewRef.current,
        screen: { x: e.clientX, y: e.clientY },
        scale: svg.current!.getScreenCTM()!.a,
      };
      return;
    }
    if (['outlet', 'monitor', 'quiet'].includes(tool)) {
      if (id)
        try {
          change(geometry.toggleBadge(current, id, tool as Feature));
        } catch (e) {
          setMessage(String(e));
        }
      return;
    }
    if (tool !== 'select' && !resize) {
      try {
        const next = geometry.place(
          room,
          current,
          tool,
          p.x,
          p.y,
          crypto.randomUUID(),
        );
        change(next);
        setSelected(
          next.find((o) => !current.some((old) => old.id === o.id))?.id || null,
        );
        setMessage('Placed.');
      } catch (e) {
        setMessage(e instanceof Error ? e.message : 'Cannot place here');
      }
      return;
    }
    if (id) {
      const item = current.find((o) => o.id === id)!;
      setSelected(id);
      drag.current = {
        kind: resize ? 'resize' : 'item',
        id,
        handle: resize || undefined,
        before: geometry.clone(current),
        base: geometry.clone(current),
        start: p,
        last: p,
        x: item.x,
        y: item.y,
        view: viewRef.current,
        screen: { x: e.clientX, y: e.clientY },
        scale: svg.current!.getScreenCTM()!.a,
      };
    } else setSelected(null);
  }
  function move(e: ReactPointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      setViewport({
        ...d.view,
        x: d.view.x - (e.clientX - d.screen.x) / d.scale,
        y: d.view.y - (e.clientY - d.screen.y) / d.scale,
      });
      return;
    }
    const p = point(e);
    d.last = p;
    try {
      const next =
        d.kind === 'resize'
          ? geometry.resize(room, d.before, d.id!, d.handle!, p.x, p.y)
          : geometry.move(
              room,
              d.base,
              d.id!,
              d.x + p.x - d.start.x,
              d.y + p.y - d.start.y,
            );
      change(next, false);
      setMessage(next === d.base ? 'Position blocked.' : '');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Change blocked');
    }
  }
  function end(e: ReactPointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (d && d.kind !== 'pan') record(d.before);
    drag.current = null;
    if (svg.current?.hasPointerCapture(e.pointerId))
      svg.current.releasePointerCapture(e.pointerId);
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (
        (e.target as Element).closest(
          'input,select,textarea,[contenteditable="true"]',
        ) ||
        globalThis.document.querySelector('[role="dialog"]')
      )
        return;
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') {
        e.preventDefault();
        if (drag.current && drag.current.kind !== 'pan') {
          objectsRef.current = drag.current.before;
          setObjects(drag.current.before);
        }
        drag.current = null;
        setTool('select');
        setMenu(null);
        return;
      }
      if (e.code === 'Space' && drag.current?.kind === 'item') {
        e.preventDefault();
        if (e.repeat) return;
        const d = drag.current;
        try {
          const item = objectsRef.current.find((o) => o.id === d.id)!;
          const next = geometry.update(room, objectsRef.current, d.id!, {
            angle: (item.angle + 90) % 360,
          });
          objectsRef.current = next;
          setObjects(next);
          d.base = geometry.clone(next);
          d.start = d.last;
          const rotated = next.find((o) => o.id === d.id)!;
          d.x = rotated.x;
          d.y = rotated.y;
          setMessage('Rotated 90°.');
        } catch (error) {
          setMessage(String(error));
        }
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        if (k === 'z' || k === 'y') {
          e.preventDefault();
          const reversing = k === 'z' && !e.shiftKey;
          const source = reversing ? undo : redo,
            target = reversing ? redo : undo;
          const next = source.current.pop();
          if (next) {
            target.current.push(geometry.clone(objectsRef.current));
            objectsRef.current = next;
            setObjects(next);
            setSelected(null);
          }
        } else if (k === 's') {
          e.preventDefault();
          globalThis.document.getElementById('admin-save-layout')?.click();
        }
        return;
      }
      if (e.altKey) return;
      const match = tools.find(
        ([, , shortcut]) => shortcut.toLowerCase() === k,
      );
      if (match) {
        e.preventDefault();
        setTool(match[0]);
        setMenu(null);
      } else if (k === 'b') {
        e.preventDefault();
        setMenu('features');
      } else if (k === 'f') {
        e.preventDefault();
        const v = { x: 0, y: 0, width: room.width, height: room.height };
        viewRef.current = v;
        setView(v);
      } else if (k === 'r' && selected) {
        e.preventDefault();
        globalThis.document.getElementById('admin-rotate-item')?.click();
      } else if (['Delete', 'Backspace'].includes(e.key) && selected) {
        e.preventDefault();
        const before = objectsRef.current,
          next = geometry.remove(before, selected);
        undo.current.push(geometry.clone(before));
        redo.current = [];
        objectsRef.current = next;
        setObjects(next);
        setSelected(null);
      }
    }
    globalThis.document.addEventListener('keydown', key);
    return () => globalThis.document.removeEventListener('keydown', key);
  }, [room, selected]);
  const item = objects.find((o) => o.id === selected);
  const live = objects.map((o) =>
    o.type === 'seat'
      ? {
          ...o,
          state:
            space.seats.find((s) => s.id === o.backendSeatId)?.state ||
            'unknown',
        }
      : o,
  );
  const scale =
    Math.min(canvasSize.width / view.width, canvasSize.height / view.height) ||
    1;
  const resizeEditProps = {
    onFocus: () => {
      editing.current = geometry.clone(objectsRef.current);
    },
    onBlur: () => {
      if (editing.current) record(editing.current);
      editing.current = null;
    },
  };
  return (
    <div className="grid gap-4">
      <div className="admin-editor-tools">
        <Button
          variant={tool === 'select' ? 'secondary' : 'quiet'}
          onClick={() => {
            setTool('select');
            setMenu(null);
          }}
        >
          Select <kbd>Esc</kbd>
        </Button>
        <Button
          variant="quiet"
          aria-expanded={menu === 'table'}
          onClick={() => setMenu(menu === 'table' ? null : 'table')}
        >
          Tables <kbd>T</kbd>
        </Button>
        {tools
          .filter(([t]) => ['seat', 'window', 'door', 'row'].includes(t))
          .map(([t, label, key]) => (
            <Button
              key={t}
              variant={tool === t ? 'secondary' : 'quiet'}
              onClick={() => {
                setTool(t);
                setMenu(null);
              }}
              title={label + ' (' + key + ')'}
            >
              {label}
              <kbd>{key}</kbd>
            </Button>
          ))}
        <Button
          variant="quiet"
          aria-expanded={menu === 'features'}
          onClick={() => setMenu(menu === 'features' ? null : 'features')}
        >
          Features <kbd>B</kbd>
        </Button>
        {menu && (
          <div className="flex flex-wrap gap-1">
            {tools
              .filter(([t]) =>
                menu === 'table'
                  ? ['table', 'round', 'l', 'curved'].includes(t)
                  : ['outlet', 'monitor', 'quiet'].includes(t),
              )
              .map(([t, label, key]) => (
                <Button
                  key={t}
                  variant="quiet"
                  onClick={() => {
                    setTool(t);
                    setMenu(null);
                  }}
                >
                  {label}
                  <kbd>{key}</kbd>
                </Button>
              ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Text size="sm" c="dimmed">
          {room.label} · approximately{' '}
          {room.measurements.widthMeters.toFixed(1)} ×{' '}
          {room.measurements.heightMeters.toFixed(1)} m ·{' '}
          {objects.filter((o) => o.type === 'seat').length} seats
        </Text>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="quiet"
            disabled={!history.undo}
            onClick={() => {
              const next = undo.current.pop();
              if (next) {
                redo.current.push(geometry.clone(objectsRef.current));
                change(next, false);
                setSelected(null);
              }
            }}
          >
            Undo
          </Button>
          <Button
            variant="quiet"
            disabled={!history.redo}
            onClick={() => {
              const next = redo.current.pop();
              if (next) {
                undo.current.push(geometry.clone(objectsRef.current));
                change(next, false);
                setSelected(null);
              }
            }}
          >
            Redo
          </Button>
          <Button
            variant="danger"
            onClick={() => setClear(true)}
            disabled={!objects.length}
          >
            Delete layout
          </Button>
          <Button
            id="admin-save-layout"
            disabled={action.busy || space.is_archived}
            onClick={() =>
              void action.run(
                (force) =>
                  api.adminSaveLayout({
                    path: { space_id: space.id },
                    headers: adminHeaders,
                    query: { force },
                    body: {
                      layout: documentFor(
                        room,
                        objectsRef.current,
                      ) as unknown as Record<string, unknown>,
                    },
                    throwOnError: true,
                  }),
                'Layout saved with stable seat IDs and QR tokens.',
              )
            }
          >
            Save layout
          </Button>
        </div>
      </div>
      <div className="admin-editor-grid">
        <div className="admin-editor-canvas">
          <svg
            ref={svg}
            tabIndex={0}
            aria-label="Room layout editor"
            viewBox={
              view.x + ' ' + view.y + ' ' + view.width + ' ' + view.height
            }
            onPointerDown={begin}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={(e) => {
              if (drag.current?.kind !== 'pan' && drag.current)
                change(drag.current.before, false);
              end(e);
            }}
            onWheel={(e) => {
              if (drag.current) return;
              e.preventDefault();
              const p = point(e),
                factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
              const width = Math.min(
                  room.width * 4,
                  Math.max(room.width / 8, viewRef.current.width * factor),
                ),
                ratio = width / viewRef.current.width;
              setViewport({
                x: p.x - (p.x - viewRef.current.x) * ratio,
                y: p.y - (p.y - viewRef.current.y) * ratio,
                width,
                height: viewRef.current.height * ratio,
              });
            }}
          >
            <RoomScene
              room={room}
              objects={live}
              selected={selected}
              editor
              scale={scale}
              onSelect={setSelected}
            />
          </svg>
          <div className="absolute right-3 bottom-3 flex gap-1">
            {[
              ['+', 'Zoom in', 0.8],
              ['−', 'Zoom out', 1.25],
            ].map(([label, title, factor]) => (
              <Button
                key={label}
                variant="secondary"
                aria-label={String(title)}
                onClick={() =>
                  setViewport({
                    ...viewRef.current,
                    width: viewRef.current.width * Number(factor),
                    height: viewRef.current.height * Number(factor),
                  })
                }
              >
                {label}
              </Button>
            ))}
            <Button
              variant="secondary"
              aria-label="Fit room"
              onClick={() =>
                setViewport({
                  x: 0,
                  y: 0,
                  width: room.width,
                  height: room.height,
                })
              }
            >
              <Icon name="fitRoom" />
            </Button>
          </div>
        </div>
        <Card className="grid content-start gap-3 p-4">
          <Title order={2}>
            {item
              ? item.type === 'seat'
                ? 'Seat ' + item.number
                : item.label || item.type
              : 'Selection'}
          </Title>
          {!item ? (
            <Text c="dimmed">
              Select an item to edit it. Space rotates it while dragging. Middle
              mouse pans; wheel zooms.
            </Text>
          ) : (
            <>
              <TextInput
                label="Label"
                value={item.label || ''}
                disabled={item.type === 'seat'}
                onChange={(e) => edit({ label: e.currentTarget.value })}
              />
              {['table', 'row'].includes(item.type) && (
                <Button
                  id="admin-rotate-item"
                  variant="quiet"
                  onClick={() => edit({ angle: (item.angle + 90) % 360 })}
                >
                  Rotate 90° <kbd>R</kbd>
                </Button>
              )}
              {item.type === 'table' && (
                <>
                  <NativeSelect
                    label="Shape"
                    value={item.shape || 'rect'}
                    data={[
                      { value: 'rect', label: 'Rectangle' },
                      { value: 'round', label: 'Round' },
                      { value: 'l', label: 'L shape' },
                      { value: 'curved', label: 'Curved' },
                    ]}
                    onChange={(e) =>
                      edit({
                        shape: e.currentTarget.value as LayoutItem['shape'],
                      })
                    }
                  />
                  {item.shape === 'curved' && (
                    <NumberInput
                      label="Curvature (%)"
                      min={0}
                      max={100}
                      value={item.curvature || 0}
                      onChange={(v) => edit({ curvature: Number(v) })}
                      {...resizeEditProps}
                    />
                  )}
                </>
              )}
              {item.type === 'row' && (
                <>
                  {(
                    [
                      ['Rows', 'rows', 1, 20],
                      ['Seats in first row', 'count', 1, 40],
                      ['Arc (degrees)', 'sweep', 0, 180],
                      ['Radius', 'radius', 100, 1200],
                    ] as const
                  ).map(([label, key, min, max]) => (
                    <NumberInput
                      key={key}
                      label={label}
                      value={item[key] || 0}
                      min={min}
                      max={max}
                      onChange={(v) => edit({ [key]: Number(v) })}
                      {...resizeEditProps}
                    />
                  ))}
                </>
              )}
              {item.type === 'seat' && (
                <>
                  <Text size="sm">
                    {space.seats
                      .find((s) => s.id === item.backendSeatId)
                      ?.state.replace('_', ' ') || 'Not saved to backend yet'}
                  </Text>
                  <NativeSelect
                    label="Backend seat"
                    description="Assign an existing seat to keep its QR label. Unassigned positions create new seats on save."
                    value={item.backendSeatId || ''}
                    data={[
                      { value: '', label: 'Create new seat' },
                      ...space.seats
                        .filter(
                          (seat) =>
                            seat.id === item.backendSeatId ||
                            !objects.some((o) => o.backendSeatId === seat.id),
                        )
                        .map((seat) => ({
                          value: seat.id,
                          label:
                            'Seat ' +
                            seat.label +
                            (seat.is_active ? '' : ' (inactive)'),
                        })),
                    ]}
                    onChange={(e) =>
                      edit({
                        backendSeatId: e.currentTarget.value || undefined,
                      })
                    }
                  />
                  <Checkbox
                    label="Active seat"
                    checked={item.active !== false}
                    onChange={(e) => edit({ active: e.currentTarget.checked })}
                  />
                </>
              )}
              {['seat', 'table'].includes(item.type) &&
                (Object.entries(geometry.BADGES) as [Feature, string][]).map(
                  ([feature, label]) => (
                    <Checkbox
                      key={feature}
                      label={label}
                      checked={item.badges?.includes(feature) || false}
                      value={feature}
                      onChange={onFeatureChange}
                    />
                  ),
                )}
              <Button
                variant="danger"
                onClick={() => {
                  change(geometry.remove(objectsRef.current, item.id));
                  setSelected(null);
                }}
              >
                Remove {item.type}
              </Button>
            </>
          )}
        </Card>
      </div>
      <Text size="sm" role="status">
        {message || 'Tool: ' + tool + (dirty ? ' · Unsaved changes' : '')}
      </Text>
      <AdminFeedback action={action} />
      <DecisionSheet
        opened={clear}
        onClose={() => setClear(false)}
        title="Delete the whole layout?"
        safeLabel="Keep layout"
        actionLabel="Delete layout"
        actionTone="danger"
        onConfirm={() => {
          change([]);
          setSelected(null);
          setClear(false);
        }}
      >
        Furniture and seat placements are removed. Undo restores them until you
        save.
      </DecisionSheet>
      <DecisionSheet
        opened={blocker.state === 'blocked'}
        onClose={() => {
          if (blocker.state === 'blocked') blocker.reset();
        }}
        title="Leave without saving?"
        safeLabel="Keep editing"
        actionLabel="Discard changes"
        actionTone="danger"
        onConfirm={() => {
          if (blocker.state === 'blocked') blocker.proceed();
        }}
      >
        Your unsaved layout changes will be lost.
      </DecisionSheet>
    </div>
  );
}
