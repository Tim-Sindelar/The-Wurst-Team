import {
  ActionIcon,
  Avatar,
  Card,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { Link, useSearchParams } from 'react-router';
import { cx } from '../components/cx';
import { Icon } from '../components/Icon';
import { Placeholder } from '../components/Placeholder';
import { Screen, ScreenMain } from '../components/Screen';
import { SpaceCard } from '../components/SpaceCard';
import { ThemeToggle } from '../components/ThemeToggle';
import { stripeClass, type SeatState } from '../domain/seat';
import type { BookingState } from '../mock/bookingContext';
import { mockSpace, mockUser, studySpaces } from '../mock/data';
import { useMockBooking } from '../mock/useMockBooking';
import { paths } from '../routes';

/* ?state=reserved, ?state=session or ?state=none forces the booking card. */
const forcedState = (value: string | null): BookingState | null =>
  value === 'reserved' || value === 'session' || value === 'none'
    ? value
    : null;

export function HomeScreen() {
  const { seat, booking } = useMockBooking();
  const [params] = useSearchParams();
  const state = forcedState(params.get('state')) ?? booking;

  return (
    <Screen>
      <ScreenMain>
        <div className="flex items-center justify-between gap-2">
          <Title order={1}>Study Spaces</Title>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <ActionIcon
              component={Link}
              to={paths.profile}
              aria-label="Profile"
              className="-mr-0.5"
            >
              <Avatar aria-hidden="true">{mockUser.initials}</Avatar>
            </ActionIcon>
          </div>
        </div>

        <div className="sticky top-0 z-2 -mx-4 -mt-4 -mb-2 bg-bg px-4 pt-4 pb-2">
          <TextInput
            type="search"
            placeholder="Search study spaces"
            aria-label="Search study spaces"
            leftSection={<Icon name="search" />}
          />
        </div>

        {state === 'reserved' && (
          <BookingCard
            to={paths.reservation}
            stripe="reserved"
            title={`Seat ${seat} · ${mockSpace.name}`}
            detail="Reserved · tap to check in"
          />
        )}
        {state === 'session' && (
          <BookingCard
            to={paths.session}
            stripe="yours"
            title={`Seat ${seat} · ${mockSpace.name}`}
            detail="In session · tap to open"
          />
        )}

        <ul
          className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pt-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Recent and favourite study spaces"
        >
          {studySpaces.map((space) => (
            <li key={space.id} className="min-w-0 flex-[0_0_72%] snap-start">
              <SpaceCard space={space} />
            </li>
          ))}
        </ul>

        <Title order={2} className="sr-only">
          Campus map
        </Title>
        <Placeholder
          icon="map"
          label="Campus map goes here"
          description="Placeholder: the campus map goes here"
        />
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
