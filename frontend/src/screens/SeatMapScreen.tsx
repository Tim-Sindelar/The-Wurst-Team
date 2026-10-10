import { Button, Card, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AvailabilityLabel } from '../components/AvailabilityLabel';
import { DecisionSheet } from '../components/DecisionSheet';
import {
  ActionBar,
  Screen,
  ScreenHeader,
  ScreenMain,
} from '../components/Screen';
import { SeatChip } from '../components/SeatChip';
import { SeatMap } from '../components/seat-map/SeatMap';
import {
  isReservable,
  seatStateDetail,
  seatStateName,
  stripeClass,
} from '../domain/seat';
import { mockRules, mockSpace, roomSeats } from '../mock/data';
import { useMockBooking } from '../mock/useMockBooking';
import { paths } from '../routes';

const holdMinutes = mockRules.holdSeconds / 60;

export function SeatMapScreen() {
  const navigate = useNavigate();
  const booking = useMockBooking();
  const [selected, setSelected] = useState(booking.seat);
  const [sheetOpen, setSheetOpen] = useState(false);

  const seats = roomSeats.map((item) =>
    booking.booking === 'reserved' && item.number === booking.seat
      ? { ...item, state: 'reserved' as const }
      : item,
  );
  const freeCount = seats.filter((item) => item.state === 'free').length;
  const seat = seats.find((item) => item.number === selected) ?? roomSeats[0];
  const later = seat.state === 'bookable';
  const ownReservation =
    booking.booking === 'reserved' && seat.number === booking.seat;

  const reserveLabel = ownReservation
    ? 'View reservation'
    : seat.state === 'free'
      ? `Reserve seat ${seat.number}`
      : later
        ? `Reserve seat ${seat.number} for later`
        : `${seatStateName[seat.state]} · unavailable`;

  const chooseAnyFree = () => {
    const free = seats.find((item) => item.state === 'free');
    if (free) setSelected(free.number);
  };

  const reserve = () => {
    booking.reserveSeat(seat.number);
    navigate(paths.reservation);
  };

  return (
    <Screen className="h-dvh overflow-hidden">
      <ScreenHeader
        title="Study Spaces"
        backTo={paths.home}
        backLabel="Back to home"
      />

      <ScreenMain fit>
        <div className="grid gap-1">
          <Title order={2} className="text-heading">
            {mockSpace.name}
          </Title>
          <AvailabilityLabel availability="high" size="small">
            {freeCount} free of {roomSeats.length} seats
          </AvailabilityLabel>
        </div>

        <div className="min-h-0 flex-1 basis-0">
          <SeatMap seats={seats} selected={selected} onSelect={setSelected} />
        </div>

        <Card
          component="article"
          className={stripeClass.yours}
          aria-labelledby="selected-seat-title"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Title order={3} id="selected-seat-title">
              Seat {seat.number}
            </Title>
            <SeatChip state={seat.state} />
          </div>
          <Text size="sm" c="dimmed">
            {mockSpace.name} ·{' '}
            {ownReservation ? 'Reserved for you' : seatStateDetail[seat.state]}
          </Text>
          <Text size="sm">{seat.feature}</Text>
        </Card>
      </ScreenMain>

      <ActionBar>
        <Button variant="secondary" fullWidth onClick={chooseAnyFree}>
          Choose any free seat
        </Button>
        <Button
          fullWidth
          disabled={
            !ownReservation &&
            (booking.booking !== 'none' || !isReservable(seat.state))
          }
          onClick={() =>
            ownReservation ? navigate(paths.reservation) : setSheetOpen(true)
          }
        >
          {reserveLabel}
        </Button>
      </ActionBar>

      <DecisionSheet
        opened={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={`Reserve seat ${seat.number}?`}
        safeLabel="Cancel"
        actionLabel={`Reserve seat ${seat.number}`}
        onConfirm={reserve}
      >
        {later
          ? `${mockSpace.name}. Your time starts when the current session ends. Check in within ${holdMinutes} minutes after that.`
          : `${mockSpace.name}. Held for ${holdMinutes} minutes. Check in before it runs out.`}
      </DecisionSheet>
    </Screen>
  );
}
