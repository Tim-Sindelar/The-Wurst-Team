import { Notification, Transition } from '@mantine/core';
import { useEffect, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

type StatusBannerProps = {
  opened: boolean;
  onClose: () => void;
  icon: IconName;
  title: string;
  children?: ReactNode;
  /** Urgent banners stay until dismissed; others hide after about 6 seconds. */
  urgent?: boolean;
};

const AUTO_HIDE_MS = 6000;

/** Notification banner that slides in from the top to say something happened. */
export function StatusBanner({
  opened,
  onClose,
  icon,
  title,
  children,
  urgent = false,
}: StatusBannerProps) {
  useEffect(() => {
    if (!opened || urgent) return;
    const id = setTimeout(onClose, AUTO_HIDE_MS);
    return () => clearTimeout(id);
  }, [opened, urgent, onClose]);

  return (
    <div className="pointer-events-none fixed top-0 left-1/2 z-30 grid w-full max-w-phone -translate-x-1/2 gap-2 p-2">
      <Transition
        mounted={opened}
        transition="slide-down"
        duration={250}
        timingFunction="cubic-bezier(0.2, 0, 0, 1)"
      >
        {(styles) => (
          <Notification
            style={styles}
            className="pointer-events-auto"
            role={urgent ? 'alert' : 'status'}
            icon={<Icon name={icon} />}
            title={title}
            onClose={onClose}
          >
            {children}
          </Notification>
        )}
      </Transition>
    </div>
  );
}
