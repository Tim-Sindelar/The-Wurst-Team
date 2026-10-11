import { Alert, Card, Text, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { AppName } from '../components/AppName';
import { listSpacesOptions } from '../api/generated/@tanstack/react-query.gen';
import { cx } from '../components/cx';
import { Icon } from '../components/Icon';
import { RequestsBell } from '../components/RequestsBell';
import { SafeAreaTop, Screen, ScreenMain } from '../components/Screen';
import { SpaceLists } from '../components/SpaceLists';
import { stripeClass, type SeatState } from '../domain/seat';
import { filterSpaces, spaceRows, toStudySpace } from '../domain/space';
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
  const rows = spaces && spaceRows(spaces, recents.ids, popular.ids);

  return (
    <Screen className="h-full overflow-hidden">
      <SafeAreaTop />
      <ScreenMain fit className="[&>div:last-child]:shrink">
        <div className="flex items-center justify-between gap-2">
          <Title order={1}>
            <AppName />
          </Title>
          <RequestsBell />
        </div>

        <div className="-mx-4 -mt-4 -mb-2 bg-bg px-4 pt-4 pb-2">
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
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <SpaceLists
              fit
              matches={spaces}
              search={search}
              rows={rows}
              onToggleFavourite={favourites.toggle}
            />
          </div>
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
