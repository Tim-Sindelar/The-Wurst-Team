import { Alert, Card, Text, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { listSpacesOptions } from '../api/generated/@tanstack/react-query.gen';
import { cx } from '../components/cx';
import { Icon } from '../components/Icon';
import { SafeAreaTop, Screen, ScreenMain } from '../components/Screen';
import { SectionLabel } from '../components/SectionLabel';
import { SpaceCard } from '../components/SpaceCard';
import { stripeClass, type SeatState } from '../domain/seat';
import {
  favouriteSpaces,
  filterSpaces,
  spacesByIds,
  toStudySpace,
  type StudySpace,
} from '../domain/space';
import { useFavourites } from '../hooks/useFavourites';
import { usePopular } from '../hooks/usePopular';
import { useRecents } from '../hooks/useRecents';
import { formatCountdown, secondsUntil } from '../hooks/useCountdown';
import { useNow } from '../hooks/useNow';
import { useMyReservation } from '../hooks/useMyReservation';
import { paths } from '../routes';

export function HomeScreen() {
  const spacesQuery = useQuery({
    ...listSpacesOptions(),
    refetchInterval: 15_000,
  });
  const {
    query: reservationQuery,
    reservation,
    held,
    running,
    toClient,
  } = useMyReservation();
  const favourites = useFavourites();
  const recents = useRecents();
  const popular = usePopular();
  const [search, setSearch] = useState('');
  const allSpaces = spacesQuery.data?.spaces.map((space) =>
    toStudySpace(space, favourites.ids.has(space.id)),
  );
  const spaces = allSpaces && filterSpaces(allSpaces, search);
  const searching = search.trim() !== '';
  const rows = spaces && [
    { id: 'favourites', title: 'Favourites', spaces: favouriteSpaces(spaces) },
    {
      id: 'recent',
      title: 'Recent',
      spaces: spacesByIds(spaces, recents.ids),
    },
    {
      id: 'popular',
      title: 'Most popular',
      spaces: spacesByIds(spaces, popular.ids),
    },
  ];

  return (
    <Screen>
      <SafeAreaTop />
      <ScreenMain>
        <Title order={1}>Study Spaces</Title>

        <div className="sticky top-[env(safe-area-inset-top)] z-2 -mx-4 -mt-4 -mb-2 bg-bg px-4 pt-4 pb-2">
          <TextInput
            type="search"
            placeholder="Search study spaces"
            aria-label="Search study spaces"
            leftSection={<Icon name="search" />}
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </div>

        {reservation && (held || running) && (
          <BookingCard
            to={held ? paths.reservation : paths.session}
            stripe={held ? 'reserved' : 'yours'}
            title={`Seat ${reservation.seat.label} · ${reservation.space.name}`}
            detail={
              held ? (
                'Reserved · tap to check in'
              ) : (
                <SessionDetail
                  onBreak={running?.status === 'on_break'}
                  endsAt={
                    running?.status === 'on_break' && running.current_break
                      ? toClient(running.current_break.ends_at)
                      : toClient(running!.ends_at)
                  }
                />
              )
            }
          />
        )}
        {reservationQuery.isError && (
          <Alert
            variant="danger"
            role="alert"
            icon={<Icon name="alert" />}
            title="Couldn't load your booking"
          >
            <Text size="sm">Check your connection and try again.</Text>
          </Alert>
        )}

        {favourites.failed && (
          <Alert
            variant="danger"
            role="alert"
            icon={<Icon name="alert" />}
            title="Couldn't update your favourites"
          >
            <Text size="sm">Check your connection and try again.</Text>
          </Alert>
        )}

        {spacesQuery.isError ? (
          <Alert
            variant="danger"
            role="alert"
            icon={<Icon name="alert" />}
            title="Couldn't load study spaces"
          >
            <Text size="sm">Check your connection and try again.</Text>
          </Alert>
        ) : !rows || (!searching && popular.query.isPending) ? (
          <Text c="dimmed" role="status">
            Loading study spaces…
          </Text>
        ) : searching ? (
          spaces.length === 0 ? (
            <Text c="dimmed" role="status">
              No study spaces match “{search.trim()}”.
            </Text>
          ) : (
            <ul className="grid gap-3" aria-label="Search results">
              {spaces.map((space) => (
                <li key={space.id}>
                  <SpaceCard
                    space={space}
                    onToggleFavourite={(on) => favourites.toggle(space.id, on)}
                  />
                </li>
              ))}
            </ul>
          )
        ) : rows.every((row) => row.spaces.length === 0) ? (
          <Text c="dimmed" role="status">
            No study spaces yet.
          </Text>
        ) : (
          rows.map(
            (row) =>
              row.spaces.length > 0 && (
                <SpaceRow
                  key={row.id}
                  id={row.id}
                  title={row.title}
                  spaces={row.spaces}
                  onToggleFavourite={favourites.toggle}
                />
              ),
          )
        )}
      </ScreenMain>
    </Screen>
  );
}

type BookingCardProps = {
  to: string;
  stripe: SeatState;
  title: string;
  detail: ReactNode;
};

/** The card for a held or running booking, linking to its screen. */
function BookingCard({ to, stripe, title, detail }: BookingCardProps) {
  return (
    <Card
      component={Link}
      to={to}
      className={cx(
        'no-underline hover:shadow-[inset_0_0_0_100px_var(--color-hover),var(--shadow-card)]',
        stripeClass[stripe],
      )}
    >
      <div className="flex items-center gap-2">
        <div className="grid min-w-0 flex-1 gap-2">
          <Text className="text-title">{title}</Text>
          <Text size="sm" c="dimmed">
            {detail}
          </Text>
        </div>
        <Icon name="chevronRight" />
      </div>
    </Card>
  );
}

type SpaceRowProps = {
  id: string;
  title: string;
  spaces: StudySpace[];
  onToggleFavourite: (id: string, on: boolean) => void;
};

/** A titled, swipeable row of space cards. */
function SpaceRow({ id, title, spaces, onToggleFavourite }: SpaceRowProps) {
  const labelId = `space-row-${id}`;
  return (
    <section aria-labelledby={labelId} className="grid gap-2">
      <SectionLabel id={labelId}>{title}</SectionLabel>
      <ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pt-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {spaces.map((space) => (
          <li key={space.id} className="min-w-0 flex-[0_0_72%] snap-start">
            <SpaceCard
              space={space}
              onToggleFavourite={(on) => onToggleFavourite(space.id, on)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "In session" (or "On break") with the time left ticking next to it. */
function SessionDetail({
  onBreak,
  endsAt,
}: {
  onBreak: boolean;
  endsAt: number;
}) {
  const now = useNow();
  return (
    <>
      {onBreak ? 'On break' : 'In session'} ·{' '}
      <span className="font-bold tabular-nums">
        {formatCountdown(secondsUntil(endsAt, now))}
      </span>{' '}
      left
    </>
  );
}
