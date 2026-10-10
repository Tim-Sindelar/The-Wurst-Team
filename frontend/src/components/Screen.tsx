import { ActionIcon, Title } from '@mantine/core';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cx } from './cx';
import { Icon } from './Icon';

/* The screen frame: fills the whole width of any phone (no side margins),
   becomes a centred 390px column from 480px up. Full height, with the
   action bar pinned to the bottom. */

export function Screen({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'relative mx-auto flex min-h-dvh w-full flex-col bg-bg tablet:max-w-phone tablet:border-x tablet:border-border',
        className,
      )}
    >
      {children}
    </div>
  );
}

type ScreenHeaderProps = {
  title: string;
  backTo: string;
  backLabel: string;
  /** A line under the title, such as how many seats are free. */
  subtitle?: ReactNode;
};

/** Top bar: back arrow, screen title (and optional subtitle). */
export function ScreenHeader({
  title,
  backTo,
  backLabel,
  subtitle,
}: ScreenHeaderProps) {
  return (
    <header className="border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
      <div className="flex min-h-16 items-center gap-2 pr-2 pl-4">
        <ActionIcon component={Link} to={backTo} aria-label={backLabel}>
          <Icon name="back" />
        </ActionIcon>
        <Title
          order={1}
          className={cx(
            'min-w-0 flex-1 text-title font-bold',
            subtitle ? 'line-clamp-2 [overflow-wrap:anywhere]' : 'truncate',
          )}
        >
          {title}
        </Title>
      </div>
      {/* Lines up under the title: gutter + 44px back button + gap. */}
      {subtitle && <div className="-mt-4 pr-4 pb-3 pl-17">{subtitle}</div>}
    </header>
  );
}

/** For screens without a header: a strip as tall as the phone's notch or status
    bar. It sticks to the top, so scrolling content never slides under the notch. */
export function SafeAreaTop() {
  return (
    <div className="sticky top-0 z-3 h-[env(safe-area-inset-top)] bg-bg" />
  );
}

/** Scrolling content of a screen, 16px gutter, 16px between blocks. */
export function ScreenMain({
  children,
  fit = false,
}: {
  children: ReactNode;
  fit?: boolean;
}) {
  return (
    <main
      className={cx(
        'flex flex-1 flex-col px-4 py-4',
        fit ? 'min-h-0 gap-3 [&>*]:shrink-0' : 'gap-4',
      )}
    >
      {children}
    </main>
  );
}

/** Bottom bar holding the screen's one primary action (and at most a secondary). */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 grid gap-2 border-t border-border bg-bg px-4 pt-3 pb-[calc(--spacing(3)+env(safe-area-inset-bottom))]">
      {children}
    </div>
  );
}
