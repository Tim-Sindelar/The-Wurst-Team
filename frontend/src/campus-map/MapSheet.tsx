import { ActionIcon, Drawer } from '@mantine/core';
import { useRef, type PointerEvent, type ReactNode } from 'react';
import { cx } from '../components/cx';
import { Icon } from '../components/Icon';

type MapSheetProps = {
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** A submenu: shows a back button that returns to its parent sheet. */
  onBack?: () => void;
  /** Nearly full height instead of fitting its content (the room dashboard,
      and the search, so it does not jump while typing). */
  tall?: boolean;
};

const SWIPE_CLOSE_DISTANCE = 80;

/* Bottom sheet for the map's settings panels and the room dashboard. Same
   frame as DecisionSheet (handle, close button, swipe down to close), with a
   scrolling body for the map panels, which bring their own sections. */
export function MapSheet({
  opened,
  onClose,
  title,
  children,
  onBack,
  tall = false,
}: MapSheetProps) {
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
      zIndex={2000}
      transitionProps={{
        duration: 250,
        timingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
      }}
    >
      <Drawer.Overlay />
      {/* Mantine puts Drawer.Content's className on its wrapper too, so the
          layout classes go on a child. */}
      <Drawer.Content ref={contentRef}>
        <div
          className={cx(
            'campus-map-ui flex max-h-[calc(90dvh-2px)] flex-col',
            tall && 'h-[calc(90dvh-2px)]',
          )}
        >
          <div
            className="grid flex-none touch-none justify-center py-2 before:h-1 before:w-10 before:rounded-full before:bg-border-strong before:content-['']"
            onPointerDown={onGrabDown}
            onPointerMove={onGrabMove}
            onPointerUp={onGrabUp}
            onPointerCancel={onGrabCancel}
          />
          <div
            className={cx(
              'flex flex-none items-center gap-2 border-b border-border pr-2 pb-2',
              onBack ? 'pl-2' : 'pl-4',
            )}
          >
            {onBack && (
              <ActionIcon aria-label="Back" onClick={onBack}>
                <Icon name="back" />
              </ActionIcon>
            )}
            <Drawer.Title className="min-w-0 flex-1 truncate">
              {title}
            </Drawer.Title>
            <ActionIcon aria-label="Close" onClick={onClose}>
              <Icon name="close" />
            </ActionIcon>
          </div>
          <Drawer.Body className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
            {children}
          </Drawer.Body>
        </div>
      </Drawer.Content>
    </Drawer.Root>
  );
}
