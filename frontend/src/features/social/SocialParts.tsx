import { Alert, Avatar, Button, Card, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { SocialPerson } from '../../api/generated';
import { cx } from '../../components/cx';
import { Icon } from '../../components/Icon';
import { initials } from './groups';

/** A person's photo, or their initials. Someone studying right now gets an
    accent ring and a badge: a pin, or a cup while on a break. */
export function PersonAvatar({
  person,
  size,
  studying,
}: {
  person: SocialPerson;
  size?: 'sm';
  studying?: 'here' | 'break';
}) {
  const avatar = (
    <Avatar src={person.photo_url} size={size} aria-hidden="true">
      {initials(person.name)}
    </Avatar>
  );
  if (!studying) return avatar;
  return (
    <span className="relative flex-none rounded-full ring-2 ring-accent ring-offset-2 ring-offset-surface">
      {avatar}
      <span
        className="absolute -right-1.5 -bottom-1.5 grid size-5 place-items-center rounded-full border-2 border-surface bg-accent text-on-accent"
        aria-hidden="true"
      >
        <Icon name={studying === 'break' ? 'coffee' : 'pin'} size="xs" />
      </span>
    </span>
  );
}

/** Overlapping avatars of a group's people; "+2" when there are more. */
export function AvatarStack({
  people,
  max = 6,
}: {
  people: SocialPerson[];
  max?: number;
}) {
  const extra = people.length - max;
  return (
    <div className="flex" aria-hidden="true">
      {people.slice(0, max).map((person) => (
        <span
          key={person.id}
          className="-ml-2 rounded-full ring-2 ring-surface first:ml-0"
        >
          <PersonAvatar person={person} />
        </span>
      ))}
      {extra > 0 && (
        <span className="-ml-2 rounded-full ring-2 ring-surface">
          <Avatar aria-hidden="true">+{extra}</Avatar>
        </span>
      )}
    </div>
  );
}

/** Rows of people inside one card, divided by hairlines. */
export function PeopleList({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Card
      component="ul"
      aria-label={label}
      className="gap-0 divide-y divide-border overflow-hidden p-0"
    >
      {children}
    </Card>
  );
}

/** One person: avatar, name, an optional line under it, and actions at the end.
    With `to`, the person (not the actions) is a link with a chevron. With
    `stacked`, the actions sit on their own line under the name, so several
    buttons leave a long name the full width. */
export function PersonRow({
  person,
  name = person.name,
  detail,
  pinned = false,
  studying,
  to,
  stacked = false,
  children,
}: {
  person: SocialPerson;
  /** "You" for the signed-in user. */
  name?: string;
  detail?: ReactNode;
  /** The detail is a room: show the pin. */
  pinned?: boolean;
  /** Checked in right now: marks the avatar. */
  studying?: 'here' | 'break';
  /** Where tapping the person goes (their seat on the room map). */
  to?: string;
  /** Put the actions under the name (not with `to`). */
  stacked?: boolean;
  /** Buttons or a switch. */
  children?: ReactNode;
}) {
  const body = (
    <>
      <PersonAvatar person={person} studying={studying} />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <Text className="font-medium wrap-anywhere">{name}</Text>
        {detail && (
          <Text
            size="sm"
            c={pinned ? undefined : 'dimmed'}
            className="flex items-start gap-1 wrap-anywhere"
          >
            {pinned && <Icon name="pin" size="sm" className="mt-0.5" />}
            <span className="min-w-0">{detail}</span>
          </Text>
        )}
        {stacked && children && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {children}
          </div>
        )}
      </div>
    </>
  );
  return (
    <li
      className={cx(
        'flex min-h-15 items-center gap-3',
        !to && 'py-2 pl-4',
        (!to || !!children) && 'pr-3',
      )}
    >
      {to ? (
        <Link
          to={to}
          className={cx(
            'flex min-w-0 flex-1 items-center gap-3 self-stretch py-2 pl-4 text-text no-underline -outline-offset-2 hover:bg-hover',
            !children && 'pr-3',
          )}
        >
          {body}
          {!children && <Icon name="chevronRight" />}
        </Link>
      ) : (
        body
      )}
      {!stacked && children}
    </li>
  );
}

/** Loading text, or the error in place with a retry. */
export function SocialStatus({
  loading,
  error,
  retry,
  title = "Couldn't load your friends",
}: {
  loading: boolean;
  error: string;
  /** Left out when trying again can't help (the thing doesn't exist). */
  retry?: () => void;
  title?: string;
}) {
  if (error)
    return (
      <Alert
        variant="danger"
        role="alert"
        icon={<Icon name="alert" />}
        title={title}
      >
        <Text size="sm">{error}</Text>
        {retry && (
          <Button variant="secondary" className="mt-3" onClick={retry}>
            Try again
          </Button>
        )}
      </Alert>
    );
  if (loading)
    return (
      <Text c="dimmed" role="status">
        Loading…
      </Text>
    );
  return null;
}

/** A change that failed, shown in place. */
export function ActionError({ error }: { error: string }) {
  if (!error) return null;
  return (
    <Alert
      variant="danger"
      role="alert"
      icon={<Icon name="alert" />}
      title="That didn't work"
    >
      <Text size="sm">{error}</Text>
    </Alert>
  );
}
