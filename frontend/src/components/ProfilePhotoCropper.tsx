import { Button, Text } from '@mantine/core';
import { useCallback, useRef, useState, type PointerEvent } from 'react';
import {
  defaultPhotoCrop,
  type PhotoCrop,
  type ProfilePhotoSource,
} from '../domain/profilePhoto';
import { DecisionSheet } from './DecisionSheet';

const clamp = (value: number) => Math.max(-1, Math.min(1, value));
const zoomLimit = (value: number) => Math.max(1, Math.min(3, value));
type Point = { x: number; y: number };
const centre = (points: Point[]) => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
});
const distance = (points: Point[]) =>
  points.length < 2
    ? 0
    : Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);

export function ProfilePhotoCropper({
  source,
  crop,
  onChange,
  disabled = false,
}: {
  source: ProfilePhotoSource;
  crop: PhotoCrop;
  onChange: (crop: PhotoCrop) => void;
  disabled?: boolean;
}) {
  const [opened, setOpened] = useState(true);
  const [draft, setDraft] = useState(crop);
  const circle = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{
    centre: Point;
    distance: number;
    crop: PhotoCrop;
  } | null>(null);
  const beginGesture = (current: PhotoCrop) => {
    const points = [...pointers.current.values()];
    gesture.current = points.length
      ? { centre: centre(points), distance: distance(points), crop: current }
      : null;
  };
  const close = () => {
    pointers.current.clear();
    gesture.current = null;
    setOpened(false);
  };
  const attachFrame = useCallback(
    (element: HTMLButtonElement | null) => {
      if (!element || disabled) return;
      const wheel = (event: WheelEvent) => {
        event.preventDefault();
        setDraft((current) => ({
          ...current,
          zoom: zoomLimit(current.zoom * Math.exp(-event.deltaY * 0.002)),
        }));
      };
      element.addEventListener('wheel', wheel, { passive: false });
      return () => element.removeEventListener('wheel', wheel);
    },
    [disabled],
  );
  const stop = (event: PointerEvent<HTMLButtonElement>) => {
    pointers.current.delete(event.pointerId);
    beginGesture(draft);
  };
  const image = (position: PhotoCrop) => {
    const side = Math.min(source.width, source.height) / position.zoom;
    const width = (source.width / side) * 100;
    const height = (source.height / side) * 100;
    return (
      <img
        src={source.url}
        alt=""
        draggable={false}
        className="pointer-events-none absolute max-w-none select-none"
        style={{
          width: `${width}%`,
          height: `${height}%`,
          left: `${((100 - width) / 2) * (1 - position.x)}%`,
          top: `${((100 - height) / 2) * (1 - position.y)}%`,
        }}
      />
    );
  };
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        className="relative mx-auto size-24 overflow-hidden rounded-full border-2 border-border-strong bg-surface-2 p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        aria-label="Enlarge and adjust profile photo"
        onClick={() => {
          setDraft(crop);
          setOpened(true);
        }}
      >
        {image(crop)}
      </button>
      <Text size="sm" c="dimmed" className="text-center">
        Tap photo to adjust
      </Text>
      <DecisionSheet
        opened={opened}
        onClose={close}
        title="Adjust photo"
        safeLabel="Cancel"
        actionLabel="Use photo"
        onConfirm={() => {
          onChange(draft);
          close();
        }}
      >
        <div className="grid gap-3">
          <button
            ref={attachFrame}
            type="button"
            disabled={disabled}
            className="relative aspect-square w-full touch-none overflow-hidden rounded-card border border-border bg-surface-2 p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            aria-label="Position profile photo"
            aria-describedby="photo-position-hint"
            onPointerDown={(event) => {
              if (
                disabled ||
                (event.pointerType === 'mouse' && event.button !== 0)
              )
                return;
              event.currentTarget.setPointerCapture(event.pointerId);
              pointers.current.set(event.pointerId, {
                x: event.clientX,
                y: event.clientY,
              });
              beginGesture(draft);
            }}
            onPointerMove={(event) => {
              const start = gesture.current;
              if (!start || !pointers.current.has(event.pointerId) || disabled)
                return;
              pointers.current.set(event.pointerId, {
                x: event.clientX,
                y: event.clientY,
              });
              const points = [...pointers.current.values()];
              const nextCentre = centre(points);
              const size = circle.current?.getBoundingClientRect().width ?? 1;
              const side =
                Math.min(source.width, source.height) / start.crop.zoom;
              const panX = ((source.width / side - 1) * size) / 2;
              const panY = ((source.height / side - 1) * size) / 2;
              setDraft({
                x: panX
                  ? clamp(start.crop.x + (nextCentre.x - start.centre.x) / panX)
                  : 0,
                y: panY
                  ? clamp(start.crop.y + (nextCentre.y - start.centre.y) / panY)
                  : 0,
                zoom: zoomLimit(
                  start.distance
                    ? (start.crop.zoom * distance(points)) / start.distance
                    : start.crop.zoom,
                ),
              });
            }}
            onPointerUp={stop}
            onPointerCancel={stop}
            onLostPointerCapture={stop}
            onKeyDown={(event) => {
              const direction = {
                ArrowLeft: [-1, 0],
                ArrowRight: [1, 0],
                ArrowUp: [0, -1],
                ArrowDown: [0, 1],
              }[event.key];
              if (direction) {
                event.preventDefault();
                setDraft({
                  ...draft,
                  x: clamp(draft.x + direction[0] * 0.1),
                  y: clamp(draft.y + direction[1] * 0.1),
                });
              } else if (['+', '=', '-', '_'].includes(event.key)) {
                event.preventDefault();
                setDraft({
                  ...draft,
                  zoom: zoomLimit(
                    draft.zoom +
                      (event.key === '-' || event.key === '_' ? -0.1 : 0.1),
                  ),
                });
              }
            }}
          >
            <div ref={circle} className="pointer-events-none absolute inset-4">
              {image(draft)}
            </div>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-4 rounded-full border-2 border-on-photo shadow-camera-dim"
            />
          </button>
          <Text size="sm" id="photo-position-hint">
            Drag to move · Pinch or scroll to zoom
          </Text>
          <Button
            type="button"
            variant="quiet"
            onClick={() => setDraft(defaultPhotoCrop)}
          >
            Reset position
          </Button>
        </div>
      </DecisionSheet>
    </>
  );
}
