import { Alert, Avatar, Button, Card, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import type { SocialPerson } from '../../api/generated';
import { Icon } from '../../components/Icon';
import { initials } from './groups';

/** A person's photo, or their initials. */
export function PersonAvatar({
  person,
  size,
}: {
  person: SocialPerson;
  size?: 'sm';
}) {
  return (
    <Avatar src={person.photo_url} size={size} aria-hidden="true">
      {initials(person.name)}
    </Avatar>
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
      className="gap-0 divide-y divide-border p-0"
    >
      {children}
    </Card>
  );
}

/** One person: avatar, name, an optional line under it, and actions at the end. */
export function PersonRow({
  person,
  name = person.name,
  detail,
  pinned = false,
  children,
}: {
  person: SocialPerson;
  /** "You" for the signed-in user. */
  name?: string;
  detail?: ReactNode;
  /** The detail is a room: show the pin. */
  pinned?: boolean;
  /** Buttons or a switch. */
  children?: ReactNode;
}) {
  return (
    <li className="flex min-h-15 items-center gap-3 py-2 pr-3 pl-4">
      <PersonAvatar person={person} />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <Text className="font-medium break-words">{name}</Text>
        {detail && (
          <Text
            size="sm"
            c={pinned ? undefined : 'dimmed'}
            className="flex items-start gap-1 break-words"
          >
            {pinned && <Icon name="pin" size="sm" className="mt-0.5" />}
            <span className="min-w-0">{detail}</span>
          </Text>
        )}
      </div>
      {children}
    </li>
  );
}

/** Loading text, or the error in place with a retry. */
export function SocialStatus({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
}) {
  if (error)
    return (
      <Alert
        variant="danger"
        role="alert"
        icon={<Icon name="alert" />}
        title="Couldn't load your friends"
      >
        <Text size="sm">{error}</Text>
        <Button variant="secondary" className="mt-3" onClick={retry}>
          Try again
        </Button>
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
