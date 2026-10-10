import { Alert, Card, Text, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { listSpacesOptions } from '../api/generated/@tanstack/react-query.gen';
import { cx } from '../components/cx';
import { Icon } from '../components/Icon';
import { Screen, ScreenMain } from '../components/Screen';
import { SpaceCard } from '../components/SpaceCard';
import { ThemeToggle } from '../components/ThemeToggle';
import { stripeClass, type SeatState } from '../domain/seat';
import { favouritesFirst, filterSpaces, toStudySpace } from '../domain/space';
import { useFavourites } from '../hooks/useFavourites';
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
  } = useMyReservation();
  const favourites = useFavourites();
  const [search, setSearch] = useState('');
  const allSpaces = spacesQuery.data?.spaces.map((space) =>
    toStudySpace(space, favourites.ids.has(space.id)),
  );
  const spaces = allSpaces && favouritesFirst(filterSpaces(allSpaces, search));

  return (
    <Screen>
      <ScreenMain>
        <div className="flex items-center justify-between gap-2">
          <Title order={1}>Study Spaces</Title>
          <ThemeToggle />
        </div>

        <div className="sticky top-0 z-2 -mx-4 -mt-4 -mb-2 bg-bg px-4 pt-4 pb-2">
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
              held ? 'Reserved · tap to check in' : 'In session · tap to open'
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
        ) : !spaces ? (
          <Text c="dimmed" role="status">
            Loading study spaces…
          </Text>
        ) : spaces.length === 0 ? (
          <Text c="dimmed" role="status">
            No study spaces match “{search.trim()}”.
          </Text>
        ) : (
          <ul
            className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pt-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Study spaces"
          >
            {spaces.map((space) => (
              <li key={space.id} className="min-w-0 flex-[0_0_72%] snap-start">
                <SpaceCard
                  space={space}
                  onToggleFavourite={(on) => favourites.toggle(space.id, on)}
                />
              </li>
            ))}
          </ul>
        )}

        <Card
          component={Link}
          to={paths.map}
          className="no-underline hover:shadow-[inset_0_0_0_100px_var(--color-hover),var(--shadow-card)]"
        >
          <div className="flex items-center gap-3">
            <Icon name="map" size="lg" className="flex-none text-accent" />
            <div className="grid min-w-0 flex-1 gap-1">
              <Title order={2} className="text-title">
                Campus map
              </Title>
              <Text size="sm" c="dimmed">
                Workspaces, free rooms, mensas and transport on the floor plans
              </Text>
            </div>
            <Icon name="chevronRight" />
          </div>
        </Card>
      </ScreenMain>
    </Screen>
  );
}

type BookingCardProps = {
  to: string;
  stripe: SeatState;
  title: string;
  detail: string;
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
