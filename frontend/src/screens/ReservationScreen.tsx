import { Button, Card, Text, Title } from '@mantine/core';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { DecisionSheet } from '../components/DecisionSheet';
import { Icon } from '../components/Icon';
import {
  ActionBar,
  Screen,
  ScreenHeader,
  ScreenMain,
} from '../components/Screen';
import { SeatChip } from '../components/SeatChip';
import { TimerCard } from '../components/TimerCard';
import { stripeClass } from '../domain/seat';
import { mockRules, mockSpace } from '../mock/data';
import { useMockBooking } from '../mock/useMockBooking';
import { paths } from '../routes';

export function ReservationScreen() {
  const navigate = useNavigate();
  const { seat, setBooking } = useMockBooking();
  const [cancelOpen, setCancelOpen] = useState(false);

  /* Opening this screen means a seat is held (mock). */
  useEffect(() => setBooking('reserved'), [setBooking]);

  const cancel = () => {
    setBooking('none');
    navigate(paths.home);
  };

  return (
    <Screen>
      <ScreenHeader
        title="Your reservation"
        backTo={paths.seatMap}
        backLabel="Back to the seat map"
      />

      <ScreenMain>
        <Card
          component="section"
          className={stripeClass.reserved}
          aria-labelledby="seat-title"
        >
          <div className="flex items-center justify-between gap-2">
            <Title order={2} id="seat-title" className="text-heading">
              Seat {seat}
            </Title>
            <SeatChip state="reserved" plain />
          </div>
          <Text c="dimmed" className="flex items-center gap-2">
            <Icon name="pin" size="sm" /> {mockSpace.name} ·{' '}
            {mockSpace.building}
          </Text>
        </Card>

        <TimerCard
          label="Check in within"
          seconds={552}
          total={mockRules.holdSeconds}
        >
          <Text size="sm" c="dimmed">
            Scan the QR code on your table when you arrive. If the time runs
            out, the seat is released for others.
          </Text>
        </TimerCard>
      </ScreenMain>

      <ActionBar>
        <Button
          component={Link}
          to={paths.scan}
          fullWidth
          leftSection={<Icon name="qr" />}
        >
          Check in
        </Button>
        <Button
          variant="secondary"
          fullWidth
          onClick={() => setCancelOpen(true)}
        >
          Cancel reservation
        </Button>
      </ActionBar>

      <DecisionSheet
        opened={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel reservation?"
        safeLabel="Keep seat"
        actionLabel="Cancel reservation"
        actionTone="danger"
        onConfirm={cancel}
      >
        Seat {seat} becomes free for others right away.
      </DecisionSheet>
    </Screen>
  );
}
