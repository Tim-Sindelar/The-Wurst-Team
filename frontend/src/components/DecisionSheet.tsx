import { ActionIcon, Button, Drawer, Text } from '@mantine/core';
import { useRef, type PointerEvent, type ReactNode } from 'react';
import { Icon } from './Icon';

type DecisionSheetProps = {
  opened: boolean;
  /** Closing any way (X, dim area, swipe down, Esc, safe button) never confirms. */
  onClose: () => void;
  /** What will happen, as a question: "Reserve seat 14?" */
  title: ReactNode;
  /** One or two lines of detail. */
  children: ReactNode;
  /** The safe option, outlined: "Cancel", "Keep seat", "Not now". */
  safeLabel: string;
  /** The action, as a verb: "Reserve seat 14", "End session". */
  actionLabel: ReactNode;
  /** Risky actions (end, cancel) are outlined in danger instead of filled. */
  actionTone?: 'primary' | 'danger';
  onConfirm: () => void;
};

const SWIPE_CLOSE_DISTANCE = 80;

/* Bottom sheet for every decision. Slides up over a dimmed screen with a
   drag handle and a close button, then two equal buttons: safe left, action right. */
export function DecisionSheet({
  opened,
  onClose,
  title,
  children,
  safeLabel,
  actionLabel,
  actionTone = 'primary',
  onConfirm,
}: DecisionSheetProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);

  const setOffset = (dy: number) => {
    if (contentRef.current)
      contentRef.current.style.translate = dy ? `0 ${dy}px` : '';
  };

  const onGrabDown = (event: PointerEvent<HTMLDivElement>) => {
    startY.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onGrabMove = (event: PointerEvent<HTMLDivElement>) => {
    if (startY.current !== null)
      setOffset(Math.max(0, event.clientY - startY.current));
  };
  const onGrabUp = (event: PointerEvent<HTMLDivElement>) => {
    if (startY.current === null) return;
    const dy = event.clientY - startY.current;
    startY.current = null;
    setOffset(0);
    if (dy > SWIPE_CLOSE_DISTANCE) onClose();
  };
  const onGrabCancel = () => {
    startY.current = null;
    setOffset(0);
  };

  return (
    <Drawer.Root
      opened={opened}
      onClose={onClose}
      position="bottom"
      size="auto"
      transitionProps={{
        duration: 250,
        timingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
      }}
    >
      <Drawer.Overlay />
      <Drawer.Content ref={contentRef}>
        <div
          className="grid touch-none justify-center py-2 before:h-1 before:w-10 before:rounded-full before:bg-border-strong before:content-['']"
          onPointerDown={onGrabDown}
          onPointerMove={onGrabMove}
          onPointerUp={onGrabUp}
          onPointerCancel={onGrabCancel}
        />
        <ActionIcon
          className="absolute top-2 right-2"
          aria-label="Close"
          onClick={onClose}
        >
          <Icon name="close" />
        </ActionIcon>
        <Drawer.Body className="grid gap-3 px-4 pt-2 pb-[calc(--spacing(4)+env(safe-area-inset-bottom))]">
          <Drawer.Title>{title}</Drawer.Title>
          <Text component="div" c="dimmed">
            {children}
          </Text>
          <div className="ui-sheet-actions mt-2 grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={onClose}>
              {safeLabel}
            </Button>
            <Button variant={actionTone} onClick={onConfirm}>
              {actionLabel}
            </Button>
          </div>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
