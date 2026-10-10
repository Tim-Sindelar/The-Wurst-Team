import { ActionIcon, Button, Slider, Text } from '@mantine/core';
import { Icon } from './Icon';
import { useRef, type PointerEvent } from 'react';
import type { PhotoCrop, ProfilePhotoSource } from '../domain/profilePhoto';

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
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    crop: PhotoCrop;
  } | null>(null);
  const frame = useRef<HTMLButtonElement>(null);
  const side = Math.min(source.width, source.height) / crop.zoom;
  const width = (source.width / side) * 100;
  const height = (source.height / side) * 100;
  const clamp = (value: number) => Math.max(-1, Math.min(1, value));
  const stop = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointer === event.pointerId) drag.current = null;
  };
  return (
    <div className="grid gap-3">
      <button
        ref={frame}
        type="button"
        disabled={disabled}
        className="relative mx-auto size-56 touch-none overflow-hidden rounded-full border-2 border-border-strong bg-surface-2 p-0 text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-default"
        aria-label="Position profile photo. Drag to move, or use the arrow keys."
        aria-describedby="photo-position-hint"
        onPointerDown={(event) => {
          if (disabled || (event.pointerType === 'mouse' && event.button !== 0))
            return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            pointer: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            crop,
          };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start || start.pointer !== event.pointerId || disabled) return;
          const size = frame.current?.getBoundingClientRect().width ?? 1;
          const panX = ((width - 100) / 200) * size;
          const panY = ((height - 100) / 200) * size;
          onChange({
            ...crop,
            x: panX
              ? clamp(start.crop.x + (event.clientX - start.x) / panX)
              : 0,
            y: panY
              ? clamp(start.crop.y + (event.clientY - start.y) / panY)
              : 0,
          });
        }}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          const direction = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
          }[event.key];
          if (!direction || disabled) return;
          event.preventDefault();
          onChange({
            ...crop,
            x: clamp(crop.x + direction[0] * 0.1),
            y: clamp(crop.y + direction[1] * 0.1),
          });
        }}
      >
        <img
          src={source.url}
          alt=""
          draggable={false}
          className="pointer-events-none absolute max-w-none select-none"
          style={{
            width: `${width}%`,
            height: `${height}%`,
            left: `${((100 - width) / 2) * (1 - crop.x)}%`,
            top: `${((100 - height) / 2) * (1 - crop.y)}%`,
          }}
        />
      </button>
      <Text
        size="sm"
        c="dimmed"
        id="photo-position-hint"
        className="text-center"
      >
        Drag to position your photo. Use zoom to get the right fit.
      </Text>
      <div className="grid gap-2">
        <Text component="label" htmlFor="photo-zoom" size="sm">
          Zoom · {crop.zoom.toFixed(1)}×
        </Text>
        <div className="flex items-center gap-2">
          <ActionIcon
            aria-label="Zoom out"
            disabled={disabled || crop.zoom <= 1}
            onClick={() =>
              onChange({ ...crop, zoom: Math.max(1, crop.zoom - 0.1) })
            }
          >
            <Icon name="minus" />
          </ActionIcon>
          <Slider
            id="photo-zoom"
            min={1}
            max={3}
            step={0.05}
            value={crop.zoom}
            disabled={disabled}
            onChange={(zoom) => onChange({ ...crop, zoom })}
            className="min-h-11 flex-1 py-4"
            aria-label="Photo zoom"
          />
          <ActionIcon
            aria-label="Zoom in"
            disabled={disabled || crop.zoom >= 3}
            onClick={() =>
              onChange({ ...crop, zoom: Math.min(3, crop.zoom + 0.1) })
            }
          >
            <Icon name="plus" />
          </ActionIcon>
        </div>
      </div>
      <Button
        variant="quiet"
        disabled={disabled}
        onClick={() => onChange({ x: 0, y: 0, zoom: 1 })}
      >
        Reset position
      </Button>
    </div>
  );
}
