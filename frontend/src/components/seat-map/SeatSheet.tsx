import { ActionIcon, Button, Text, Title } from '@mantine/core';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type { SeatState } from '../../domain/seat';
import { Icon } from '../Icon';
import { SeatChip } from '../SeatChip';

type SeatSheetProps = {
  /** "Seat 14" */
  title: string;
  state: SeatState;
  /** Space name and what the status means for you. */
  detail: ReactNode;
  /** The one action: "Reserve seat 14", "View session". */
  actionLabel: string;
  actionDisabled?: boolean;
  onAction: () => void;
  /** The card's height in px, on mount and whenever it changes (for centring seats above it). */
  onHeight?: (height: number) => void;
  /** Close button, swipe down or Esc: the seat is deselected. */
  onClose: () => void;
};

const SWIPE_CLOSE_DISTANCE = 60;

/* Google Maps-style card at the bottom of the room map. It does not dim or
   block the map: tap another seat and it swaps; tap empty map, X or swipe down to close. */
export function SeatSheet({
  title,
  state,
  detail,
  actionLabel,
  actionDisabled = false,
  onAction,
  onHeight,
  onClose,
}: SeatSheetProps) {
  const ref = useRef<HTMLElement>(null);
  const startY = useRef<number | null>(null);
  const heightRef = useRef(onHeight);

  useEffect(() => {
    heightRef.current = onHeight;
  });

  /* Layout effect: the height is known before the map centres on the seat. */
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const report = () => heightRef.current?.(node.offsetHeight);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const setOffset = (dy: number) => {
    if (ref.current) ref.current.style.translate = dy ? `0 ${dy}px` : '';
  };
  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    startY.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (startY.current !== null)
      setOffset(Math.max(0, event.clientY - startY.current));
  };
  const onUp = (event: PointerEvent<HTMLDivElement>) => {
    if (startY.current === null) return;
    const dy = event.clientY - startY.current;
    startY.current = null;
    setOffset(0);
    if (dy > SWIPE_CLOSE_DISTANCE) onClose();
  };
  const onCancel = () => {
    startY.current = null;
    setOffset(0);
  };

  return (
    <section
      ref={ref}
      aria-label="Selected seat"
      aria-live="polite"
      className="absolute inset-x-0 bottom-0 z-2 animate-sheet-up rounded-t-sheet border border-b-0 border-border bg-surface shadow-card"
    >
      <div
        className="grid touch-none justify-center py-2 before:h-1 before:w-10 before:rounded-full before:bg-border-strong before:content-['']"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
      />
      <ActionIcon
        className="absolute top-2 right-2"
        aria-label="Close seat details"
        onClick={onClose}
      >
        <Icon name="close" />
      </ActionIcon>
      <div className="grid gap-3 px-4 pt-1 pb-[calc(--spacing(4)+env(safe-area-inset-bottom))]">
        <div className="grid gap-1 pr-11">
          <Title order={3} className="break-words">
            {title}
          </Title>
          <div>
            <SeatChip state={state} />
          </div>
          <Text size="sm" c="dimmed">
            {detail}
          </Text>
        </div>
        <Button fullWidth disabled={actionDisabled} onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
    </section>
  );
}
