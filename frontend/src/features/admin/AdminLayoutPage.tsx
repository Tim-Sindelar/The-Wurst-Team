import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useBeforeUnload, useBlocker, useOutletContext } from 'react-router';
import {
  Alert,
  ActionIcon,
  Button,
  Card,
  Checkbox,
  NativeSelect,
  NumberInput,
  Popover,
  Slider,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import * as api from '../../api/generated';
import { AdminDialog } from './AdminDialog';
import { Icon } from '../../components/Icon';
import { SectionLabel } from '../../components/SectionLabel';
import { AdminSpaceActions } from './AdminSpaceActions';
import { AdminFeedback } from './AdminFeedback';
import { AdminNewSpacePage } from './AdminNewSpacePage';
import { RoomScene } from './RoomScene';
import geometry from './geometry';
import { layoutSeatState } from './layoutSeatState';
import { rotationFromPointer } from './layoutRotation';
import { documentFor, readLayout } from './layoutDocument';
import { shortcutGroups, tools } from './layoutShortcuts';
import type {
  Feature,
  LayoutDocument,
  LayoutItem,
  RoomGeometry,
  Tool,
} from './models';
import { adminHeaders, useAdminAction } from './useAdminAction';
type Drag = {
  kind: 'item' | 'resize' | 'rotate' | 'pan';
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
    [message, setMessage] = useState(''),
    [rotating, setRotating] = useState(false),
    [clear, setClear] = useState(false),
    [shortcutsOpen, setShortcutsOpen] = useState(false),
    // Furniture size for the first table or row, while there is none to read it from.
    [emptyScale, setEmptyScale] = useState(1),
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
    spaceHeld = useRef(false),
    undo = useRef<LayoutItem[][]>([]),
    redo = useRef<LayoutItem[][]>([]),
    editing = useRef<LayoutItem[] | null>(null);
  useEffect(() => {
    const canvas = svg.current?.parentElement;
    if (!canvas) return;
    function zoom(event: WheelEvent) {
      // A non-passive listener prevents browser scrolling over the whole canvas,
      // including the zoom controls. React's delegated wheel listener is passive.
      event.preventDefault();
      event.stopPropagation();
      const target = svg.current;
      if (!target || drag.current || !event.deltaY) return;
      const matrix = target.getScreenCTM();
      if (!matrix) return;
      const screenPoint = target.createSVGPoint();
      screenPoint.x = event.clientX;
      screenPoint.y = event.clientY;
      const point = screenPoint.matrixTransform(matrix.inverse());
      const current = viewRef.current;
      const factor = event.deltaY > 0 ? 1.12 : 1 / 1.12;
      const width = Math.min(
        room.width * 4,
        Math.max(room.width / 8, current.width * factor),
      );
      const ratio = width / current.width;
      const next = {
        x: point.x - (point.x - current.x) * ratio,
        y: point.y - (point.y - current.y) * ratio,
        width,
        height: current.height * ratio,
      };
      viewRef.current = next;
      setView(next);
    }
    canvas.addEventListener('wheel', zoom, { passive: false });
    return () => canvas.removeEventListener('wheel', zoom);
  }, [room.width]);
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
  function onFeatureChange(feature: Feature) {
    if (selected)
      change(geometry.toggleBadge(objectsRef.current, selected, feature));
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
  // Sliders change the layout live and leave one undo step when released.
  function slide(next: () => LayoutItem[]) {
    editing.current ??= geometry.clone(objectsRef.current);
    try {
      change(next(), false);
      setMessage('');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Change blocked');
    }
  }
  function slideEnd() {
    if (editing.current) record(editing.current);
    editing.current = null;
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
        ?.getAttribute('data-resize'),
      rotate = (e.target as Element)
        .closest('[data-rotate]')
        ?.getAttribute('data-rotate');
    const current = objectsRef.current;
    const targetItem = current.find((item) => item.id === id);
    if (e.button === 1 || (e.button === 0 && spaceHeld.current)) {
      e.preventDefault();
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
    // A free seat position next to a table always adds a seat there,
    // whichever furniture tool is active.
    const slot = (e.target as Element).closest<SVGElement>('[data-slot]');
    if (slot && !resize && !rotate) {
      try {
        const next = geometry.place(
          room,
          current,
          'seat',
          Number(slot.dataset.x),
          Number(slot.dataset.y),
          crypto.randomUUID(),
          furnitureScale,
        );
        change(next);
        setSelected(
          next.find((o) => !current.some((old) => old.id === o.id))?.id || null,
        );
        setMessage('Seat added.');
      } catch (e) {
        setMessage(e instanceof Error ? e.message : 'Cannot place a seat here');
      }
      return;
    }
    // Clicking a seat dot while a table tool is active switches to seat mode.
    if (
      targetItem?.type === 'seat' &&
      ['table', 'round', 'l', 'curved'].includes(tool)
    ) {
      setTool('seat');
    }
    // Existing furniture takes priority over placement. The Seat tool still
    // places seats at a table or row, rather than moving its seating group.
    if (
      tool !== 'select' &&
      !resize &&
      !rotate &&
      (!targetItem ||
        (tool === 'seat' && ['table', 'row'].includes(targetItem.type)))
    ) {
      try {
        const next = geometry.place(
          room,
          current,
          tool,
          p.x,
          p.y,
          crypto.randomUUID(),
          furnitureScale,
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
    if (targetItem) {
      const item = targetItem;
      setSelected(item.id);
      setRotating(!!rotate);
      drag.current = {
        kind: rotate ? 'rotate' : resize ? 'resize' : 'item',
        id: item.id,
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
        d.kind === 'rotate'
          ? geometry.update(room, d.before, d.id!, {
              angle: rotationFromPointer(
                d.before.find((o) => o.id === d.id)!,
                d.start,
                p,
                e.shiftKey,
              ),
            })
          : d.kind === 'resize'
            ? geometry.resize(room, d.before, d.id!, d.handle!, p.x, p.y)
            : geometry.move(
                room,
                d.base,
                d.id!,
                d.x + p.x - d.start.x,
                d.y + p.y - d.start.y,
              );
      change(next, false);
      setMessage(
        d.kind === 'rotate'
          ? 'Rotation: ' +
              Math.round(next.find((o) => o.id === d.id)!.angle) +
              '°'
          : next === d.base
            ? 'Position blocked.'
            : '',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Change blocked');
    }
  }
  function end(e: ReactPointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (d && d.kind !== 'pan') record(d.before);
    drag.current = null;
    setRotating(false);
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
        setRotating(false);
        setTool('select');
        return;
      }
      // R rotates like Space mid-drag: the drag moves from its own copy of
      // the layout, so rotating only the live layout would snap back.
      if (
        (e.code === 'Space' || (k === 'r' && !e.ctrlKey && !e.metaKey)) &&
        drag.current?.kind === 'item'
      ) {
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
            setHistory({
              undo: undo.current.length,
              redo: redo.current.length,
            });
          }
        } else if (k === 's') {
          e.preventDefault();
          globalThis.document.getElementById('admin-save-layout')?.click();
        }
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (e.altKey) return;
      const match = tools.find(
        ([, , shortcut]) => shortcut.toLowerCase() === k,
      );
      if (match) {
        e.preventDefault();
        setTool(match[0]);
      } else if (k === 'b') {
        e.preventDefault();
        setTool((current) =>
          ['outlet', 'monitor', 'quiet'].includes(current)
            ? 'select'
            : 'outlet',
        );
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
        setHistory({ undo: undo.current.length, redo: redo.current.length });
      }
    }
    globalThis.document.addEventListener('keydown', key);
    return () => globalThis.document.removeEventListener('keydown', key);
  }, [room, selected]);
  useEffect(() => {
    const typing = (e: KeyboardEvent) =>
      !!(e.target as Element).closest?.(
        'input,select,textarea,button,[contenteditable="true"]',
      );
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing(e)) return;
      spaceHeld.current = true;
      if (!drag.current) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeld.current = false;
    };
    const blur = () => (spaceHeld.current = false);
    globalThis.document.addEventListener('keydown', down);
    globalThis.document.addEventListener('keyup', up);
    globalThis.addEventListener('blur', blur);
    return () => {
      globalThis.document.removeEventListener('keydown', down);
      globalThis.document.removeEventListener('keyup', up);
      globalThis.removeEventListener('blur', blur);
    };
  }, []);
  const item = objects.find((o) => o.id === selected);
  const furnitureScale = geometry.layoutScale(objects) ?? emptyScale;
  const live = objects.map((o) =>
    o.type === 'seat'
      ? {
          ...o,
          state: layoutSeatState(o, space.seats),
        }
      : o,
  );
  const tableTools = ['table', 'round', 'l', 'curved'];
  const featureTools = ['outlet', 'monitor', 'quiet'];
  const options = tableTools.includes(tool)
    ? 'table'
    : featureTools.includes(tool)
      ? 'features'
      : null;
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
      <AdminSpaceActions>
        <Button
          variant="quiet"
          className="admin-risky"
          onClick={() => setClear(true)}
          disabled={!objects.length}
        >
          Delete whole layout
        </Button>
        <Text size="sm" c="dimmed" className="self-center">
          {dirty ? 'Unsaved changes' : 'Saved'}
        </Text>
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
              'Layout saved.',
            )
          }
        >
          Save layout
        </Button>
      </AdminSpaceActions>
      <div className="admin-editor-grid">
        <section className="admin-editor-workspace">
          <div
            className="admin-editor-tools"
            role="toolbar"
            aria-label="Room editor tools"
          >
            <Button
              variant="tool"
              aria-pressed={tool === 'select'}
              onClick={() => {
                setTool('select');
              }}
            >
              Select <kbd>V</kbd>
            </Button>
            <Button
              variant="tool"
              aria-expanded={options === 'table'}
              aria-controls="admin-table-shapes"
              aria-pressed={['table', 'round', 'l', 'curved'].includes(tool)}
              onClick={() =>
                setTool(tableTools.includes(tool) ? 'select' : 'table')
              }
            >
              Table ▾ <kbd>T</kbd>
            </Button>
            {tools
              .filter(([t]) => ['seat', 'window', 'door', 'row'].includes(t))
              .map(([t, label, key]) => (
                <Button
                  key={t}
                  variant="tool"
                  aria-pressed={tool === t}
                  onClick={() => {
                    setTool(t);
                  }}
                  title={label + ' (' + key + ')'}
                >
                  {label}
                  <kbd>{key}</kbd>
                </Button>
              ))}
            <Button
              variant="tool"
              aria-expanded={options === 'features'}
              aria-controls="admin-feature-tools"
              aria-pressed={['outlet', 'monitor', 'quiet'].includes(tool)}
              onClick={() =>
                setTool(featureTools.includes(tool) ? 'select' : 'outlet')
              }
            >
              Features ▾ <kbd>B</kbd>
            </Button>
            <Popover
              opened={shortcutsOpen}
              onChange={setShortcutsOpen}
              position="bottom-end"
              offset={8}
              withinPortal
              returnFocus
            >
              <Popover.Target>
                <Button
                  variant="tool"
                  className="ml-auto"
                  leftSection={<Icon name="keyboard" size="sm" />}
                  aria-expanded={shortcutsOpen}
                  aria-keyshortcuts="?"
                  onClick={() => setShortcutsOpen((open) => !open)}
                >
                  Shortcuts <kbd>?</kbd>
                </Button>
              </Popover.Target>
              <Popover.Dropdown
                className="admin-shortcuts"
                aria-label="Keyboard shortcuts"
              >
                {shortcutGroups.map((group) => (
                  <section key={group.title} className="grid gap-2">
                    <SectionLabel as="h3">{group.title}</SectionLabel>
                    <dl className="grid gap-1.5">
                      {group.items.map((shortcut) => (
                        <div
                          key={shortcut.action}
                          className="flex items-baseline justify-between gap-4"
                        >
                          <dt className="text-small">{shortcut.action}</dt>
                          <dd className="flex flex-none gap-1">
                            {shortcut.keys.map((key) => (
                              <kbd key={key}>{key}</kbd>
                            ))}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
              </Popover.Dropdown>
            </Popover>
          </div>
          {options && (
            <div
              id={
                options === 'table'
                  ? 'admin-table-shapes'
                  : 'admin-feature-tools'
              }
              className="admin-editor-tools admin-editor-options"
              role="group"
              aria-label={
                options === 'table' ? 'Table shapes' : 'Seat features'
              }
            >
              {tools
                .filter(([t]) =>
                  options === 'table'
                    ? ['table', 'round', 'l', 'curved'].includes(t)
                    : ['outlet', 'monitor', 'quiet'].includes(t),
                )
                .map(([t, label, key]) => (
                  <Button
                    key={t}
                    variant="tool"
                    aria-pressed={tool === t}
                    onClick={() => {
                      setTool(t);
                    }}
                  >
                    {label}
                    <kbd>{key}</kbd>
                  </Button>
                ))}
            </div>
          )}
          <div className="admin-editor-canvas">
            <svg
              ref={svg}
              data-rotating={rotating || undefined}
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
            >
              <RoomScene
                room={room}
                objects={live}
                selected={selected}
                editor
                resizeHandles={tool !== 'seat' && !featureTools.includes(tool)}
                scale={scale}
                onSelect={(id) => {
                  if (tool === 'select') setSelected(id);
                }}
                onResize={(id, handle, dx, dy) => {
                  try {
                    change(
                      geometry.resizeBy(
                        room,
                        objectsRef.current,
                        id,
                        handle,
                        dx,
                        dy,
                      ),
                    );
                    setMessage('Resized to the next preset.');
                  } catch (error) {
                    setMessage(String(error));
                  }
                }}
                onRotate={(id, delta) => {
                  const current = objectsRef.current.find((o) => o.id === id);
                  if (!current) return;
                  try {
                    change(
                      geometry.update(room, objectsRef.current, id, {
                        angle: (current.angle + delta + 360) % 360,
                      }),
                    );
                    setMessage('Rotated.');
                  } catch (error) {
                    setMessage(
                      error instanceof Error
                        ? error.message
                        : 'Rotation blocked',
                    );
                  }
                }}
              />
            </svg>
            <div
              className="admin-map-controls"
              role="group"
              aria-label="Map controls"
            >
              {(
                [
                  ['plus', 'Zoom in', 0.8],
                  ['minus', 'Zoom out', 1.25],
                ] as const
              ).map(([icon, title, factor]) => (
                <ActionIcon
                  key={icon}
                  variant="map"
                  aria-label={title}
                  onClick={() => {
                    const current = viewRef.current;
                    setViewport({
                      x: current.x + (current.width * (1 - factor)) / 2,
                      y: current.y + (current.height * (1 - factor)) / 2,
                      width: current.width * factor,
                      height: current.height * factor,
                    });
                  }}
                >
                  <Icon name={icon} size="sm" />
                </ActionIcon>
              ))}
              <ActionIcon
                variant="map"
                aria-label="Fit whole room"
                onClick={() =>
                  setViewport({
                    x: 0,
                    y: 0,
                    width: room.width,
                    height: room.height,
                  })
                }
              >
                <Icon name="fitRoom" size="sm" />
              </ActionIcon>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Text size="sm" c="dimmed">
              {objects.filter((o) => o.type === 'table').length} tables ·{' '}
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
            </div>
          </div>
          <Card
            component="section"
            aria-label="Room information"
            className="admin-editor-room-info"
          >
            <div className="grid gap-2">
              <SectionLabel as="h3">Room outline</SectionLabel>
              <Text size="sm" fw={600}>
                {room.label}
              </Text>
              <Text size="sm" c="dimmed">
                {room.kind} · {space.timezone}
              </Text>
            </div>
            <div className="grid gap-2">
              <SectionLabel as="h3">Room size</SectionLabel>
              <Text size="sm">
                {room.measurements.approximate ? 'Approx. ' : ''}
                {room.measurements.widthMeters.toLocaleString('en', {
                  maximumFractionDigits: 1,
                })}{' '}
                ×{' '}
                {room.measurements.heightMeters.toLocaleString('en', {
                  maximumFractionDigits: 1,
                })}{' '}
                m
              </Text>
              {Number.isFinite(room.measurements.areaSquareMeters) && (
                <Text size="sm" c="dimmed">
                  {room.measurements.areaSquareMeters.toLocaleString('en', {
                    maximumFractionDigits: 1,
                  })}{' '}
                  m² floor area
                </Text>
              )}
            </div>
            <div className="grid gap-2">
              <SectionLabel as="h3">Phone map style</SectionLabel>
              <Text size="sm" c="dimmed">
                Numbered, colour-coded seats, muted tables and blue windows
                match the student map.
              </Text>
            </div>
            <Text size="sm" c="dimmed" className="admin-editor-room-note">
              Room outline shown to scale. Furniture keeps its approximate
              physical size. Windows and doors snap to walls; seats snap to
              tables. Overlap is blocked.
            </Text>
          </Card>
        </section>
        <Card
          component="aside"
          aria-label="Selected item properties"
          className="admin-editor-inspector grid min-w-0 content-start gap-3 p-3"
        >
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <Title order={2} className="text-body">
                Furniture size
              </Title>
              <Text size="sm" className="tabular-nums">
                {Math.round(furnitureScale * 100)}%
              </Text>
            </div>
            <Slider
              min={geometry.SCALE_RANGE[0] * 100}
              max={geometry.SCALE_RANGE[1] * 100}
              step={1}
              value={Math.round(furnitureScale * 100)}
              disabled={space.is_archived}
              thumbLabel="Furniture size"
              marks={[{ value: 100 }]}
              className="min-h-11 py-4"
              onChange={(percent) => {
                if (geometry.layoutScale(objectsRef.current) === undefined)
                  setEmptyScale(percent / 100);
                else
                  slide(() =>
                    geometry.rescale(room, objectsRef.current, percent / 100),
                  );
              }}
              onChangeEnd={slideEnd}
            />
            <Text size="sm" c="dimmed">
              Size of every table and seat, relative to its physical size.
            </Text>
          </div>
          <Title order={2} className="border-t border-border pt-3 text-body">
            Selected item
          </Title>
          {!item ? (
            <Text size="sm" c="dimmed">
              Select an item to edit it.
            </Text>
          ) : (
            <div className="grid gap-2">
              <Text size="sm" c="dimmed">
                {item.type === 'row'
                  ? 'Seat rows'
                  : item.type[0].toUpperCase() + item.type.slice(1)}
              </Text>
              {['table', 'seat'].includes(item.type) && (
                <TextInput
                  size="sm"
                  label={item.type === 'seat' ? 'Seat number' : 'Table label'}
                  value={
                    item.type === 'seat'
                      ? String(item.number ?? item.label ?? '')
                      : item.label || ''
                  }
                  readOnly={item.type === 'seat'}
                  onChange={(e) => {
                    if (item.type === 'table')
                      edit({ label: e.currentTarget.value });
                  }}
                />
              )}
              {item.type === 'table' && (
                <>
                  <NativeSelect
                    size="sm"
                    label="Table shape"
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
                      size="sm"
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
                      ['Number of rows', 'rows', 1, 20],
                      [
                        item.sweep ? 'Seats in first row' : 'Seats per row',
                        'count',
                        1,
                        40,
                      ],
                      ['Curve angle (0 = straight)', 'sweep', 0, 180],
                      ['Curve radius', 'radius', 100, 1200],
                    ] as const
                  ).map(([label, key, min, max]) => (
                    <NumberInput
                      size="sm"
                      key={key}
                      label={label}
                      value={item[key] || 0}
                      min={min}
                      max={max}
                      onChange={(v) => edit({ [key]: Number(v) })}
                      {...resizeEditProps}
                    />
                  ))}
                  {(
                    [
                      ['Row spacing', 'rowSpacing', (item.rows || 1) < 2],
                      ['Column spacing', 'seatSpacing', (item.count || 1) < 2],
                    ] as const
                  ).map(([label, key, disabled]) => (
                    <div key={key} className="grid gap-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <Text size="sm" component="span" fw={600}>
                          {label}
                        </Text>
                        <Text
                          size="sm"
                          component="span"
                          className="tabular-nums"
                        >
                          {item[key] ?? 100}%
                        </Text>
                      </div>
                      <Slider
                        min={key === 'rowSpacing' ? 60 : 70}
                        max={200}
                        step={1}
                        value={item[key] ?? 100}
                        disabled={disabled || space.is_archived}
                        thumbLabel={label}
                        marks={[{ value: 100 }]}
                        className="min-h-11 py-4"
                        onChange={(percent) =>
                          slide(() =>
                            geometry.update(room, objectsRef.current, item.id, {
                              [key]: percent,
                            }),
                          )
                        }
                        onChangeEnd={slideEnd}
                      />
                    </div>
                  ))}
                </>
              )}
              {item.type === 'seat' && (
                <>
                  <Text size="sm">
                    {space.seats
                      .find((s) => s.id === item.backendSeatId)
                      ?.state.replace('_', ' ') ||
                      (item.active === false
                        ? 'New seat · switched off'
                        : 'New seat · free')}
                  </Text>
                  <NativeSelect
                    size="sm"
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
                    size="sm"
                    label="Active seat"
                    checked={item.active !== false}
                    onChange={(e) => edit({ active: e.currentTarget.checked })}
                  />
                </>
              )}
              {['seat', 'table'].includes(item.type) && (
                <div className="grid gap-2">
                  <SectionLabel as="h3">Features</SectionLabel>
                  <div
                    className="admin-editor-tools"
                    role="group"
                    aria-label="Selected item features"
                  >
                    {(
                      Object.entries(geometry.BADGES) as [Feature, string][]
                    ).map(([feature, label]) => (
                      <Button
                        key={feature}
                        variant="tool"
                        aria-pressed={item.badges?.includes(feature) || false}
                        leftSection={
                          feature === 'quiet' ? undefined : (
                            <Icon name={feature} size="sm" />
                          )
                        }
                        onClick={() => onFeatureChange(feature)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                  {item.type === 'table' && (
                    <Text size="sm" c="dimmed">
                      Applies to every seat at this table. New seats inherit
                      table features.
                    </Text>
                  )}
                </div>
              )}
              <Text size="sm" c="dimmed">
                {item.type === 'seat'
                  ? 'Assigned automatically: clockwise around tables and row by row in auditorium seating.'
                  : item.type === 'row'
                    ? 'Changes update live. Curved outer rows fit more seats; straight rows keep equal counts. Click the row label or drag its guide to move the whole group.'
                    : item.type === 'table'
                      ? 'Drag the corner notches to resize between preset sizes. Drag just outside a corner to rotate.'
                      : 'Drag the corner notches to resize. Windows and doors snap to walls.'}
              </Text>
              {item.type === 'table' && (
                <Text size="sm" c="dimmed">
                  {geometry.slots(item).length} seat positions at this size
                </Text>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {['table', 'row'].includes(item.type) && (
                  <Button
                    id="admin-rotate-item"
                    variant="quiet"
                    aria-keyshortcuts="R"
                    onClick={() => edit({ angle: (item.angle + 90) % 360 })}
                  >
                    Rotate 90°
                  </Button>
                )}
                <Button
                  variant="quiet"
                  className="admin-risky"
                  aria-keyshortcuts="Delete"
                  onClick={() => {
                    change(geometry.remove(objectsRef.current, item.id));
                    setSelected(null);
                  }}
                >
                  Remove item
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
      <Text size="sm" role="status">
        {message || 'Tool: ' + tool + (dirty ? ' · Unsaved changes' : '')}
      </Text>
      <AdminFeedback action={action} />
      <AdminDialog
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
      </AdminDialog>
      <AdminDialog
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
      </AdminDialog>
    </div>
  );
}
