import type { ServerEvent } from '../api/generated';
import type { IconName } from '../components/Icon.tsx';
import { groupPath, socialPaths } from '../features/social/paths.ts';

export type EventNotice = {
  icon: IconName;
  title: string;
  message?: string;
  /** The screen tapping the banner opens. */
  link?: string;
};

/** What a server event says to the user. null: nothing to show (heartbeats). */
export function describeEvent(event: ServerEvent): EventNotice | null {
  switch (event.type) {
    case 'friend_request.received':
      return {
        icon: 'userPlus',
        title: `Friend request from ${event.person.name}`,
        link: socialPaths.requests,
      };
    case 'friend_request.accepted':
      return {
        icon: 'userCheck',
        title: `${event.person.name} accepted your friend request`,
        link: socialPaths.friends,
      };
    case 'party.invited':
      return {
        icon: 'mail',
        title: `${event.person.name} invited you to ${event.party_name}`,
        link: groupPath(event.party_id),
      };
    case 'party.replied':
      return {
        icon: event.accepted ? 'userCheck' : 'userX',
        title: event.accepted
          ? `${event.person.name} joined ${event.party_name}`
          : `${event.person.name} declined ${event.party_name}`,
        link: groupPath(event.party_id),
      };
    case 'party.left':
      return {
        icon: 'userMinus',
        title: `${event.person.name} left ${event.party_name}`,
        link: groupPath(event.party_id),
      };
    case 'party.booked':
      return {
        icon: 'calendarCheck',
        title: `${event.party_name} is booked`,
        message: 'Your seat is reserved. Check in when you arrive.',
        link: groupPath(event.party_id),
      };
    case 'party.cancelled':
      return {
        icon: 'calendarX',
        title: `${event.party_name} was cancelled`,
        message: 'Seats not yet checked in were released.',
        link: socialPaths.friends,
      };
    case 'ping':
      return null;
  }
}

/** The events WebSocket URL, next to the API the generated client calls. */
export function eventsUrl(apiBase: string, location: { href: string }) {
  const url = new URL(
    `${apiBase.replace(/\/$/, '')}/api/v1/events`,
    location.href,
  );
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

/** Reconnect delay: 1 s doubling to 30 s, with up to 50% jitter. */
export function reconnectDelay(attempt: number, random = Math.random()) {
  const base = Math.min(30_000, 1000 * 2 ** attempt);
  return Math.round(base * (0.5 + random / 2));
}
