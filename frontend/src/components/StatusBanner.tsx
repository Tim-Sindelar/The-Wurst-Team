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
  placement?: 'phone' | 'admin';
};

const AUTO_HIDE_MS = 6000;

/** Routine confirmations stay in the page; urgent notices float below the header. */
export function StatusBanner({
  opened,
  onClose,
  icon,
  title,
  children,
  urgent = false,
  placement = 'phone',
}: StatusBannerProps) {
  useEffect(() => {
    if (!opened || urgent) return;
    const id = setTimeout(onClose, AUTO_HIDE_MS);
    return () => clearTimeout(id);
  }, [opened, urgent, onClose]);

  return (
    <div
      className={
        placement === 'admin'
          ? 'admin-banner-region'
          : urgent
            ? 'pointer-events-none fixed top-16 left-1/2 z-30 grid w-full tablet:max-w-phone -translate-x-1/2 gap-2 p-2'
            : opened
              ? 'grid gap-2'
              : 'hidden'
      }
    >
      <Transition
        mounted={opened}
        transition={
          placement === 'admin' ? 'slide-up' : urgent ? 'slide-down' : 'fade'
        }
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
