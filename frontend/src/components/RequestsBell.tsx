import { ActionIcon } from '@mantine/core';
import { Link, useLocation } from 'react-router';
import { socialPaths } from '../features/social/paths';
import { useRequestCount } from '../features/social/useSocial';
import { Icon } from './Icon';

/** The bell in every header: opens friend requests and study group invitations,
    with the number waiting for an answer. Hidden while social is off. */
export function RequestsBell() {
  const { enabled, count } = useRequestCount();
  const { pathname } = useLocation();
  if (!enabled) return null;
  return (
    <ActionIcon
      component={Link}
      to={socialPaths.requests}
      className="relative"
      aria-label={count ? `Requests, ${count} waiting` : 'Requests'}
      aria-current={pathname === socialPaths.requests ? 'page' : undefined}
    >
      <Icon name="bell" />
      {count > 0 && (
        <span
          className="absolute top-0.5 right-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-label leading-none font-bold text-on-accent ring-2 ring-surface"
          aria-hidden="true"
        >
          {count}
        </span>
      )}
    </ActionIcon>
  );
}
