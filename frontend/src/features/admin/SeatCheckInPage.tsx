import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert, Button, Card, Text, Title } from '@mantine/core';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as q from '../../api/generated/@tanstack/react-query.gen';
import { Screen, ScreenHeader, ScreenMain } from '../../components/Screen';
import { errorMessage } from './useAdminAction';
export function SeatCheckInPage() {
  const [params] = useSearchParams(),
    cache = useQueryClient();
  const token = params.get('qr_token');
  const current = useQuery(q.getMyReservationOptions());
  const checkIn = useMutation(q.checkInMutation());
  const [confirmed, setConfirmed] = useState(false);
  return (
    <Screen>
      <ScreenHeader title="Check in" backTo="/" backLabel="Back to home" />
      <ScreenMain>
        <Title order={1}>Seat QR code</Title>
        {!token ? (
          <Alert variant="danger">Scan a seat QR code to open this page.</Alert>
        ) : current.isPending ? (
          <Text>Loading your reservation…</Text>
        ) : current.isError ? (
          <Alert variant="danger">{errorMessage(current.error)}</Alert>
        ) : !current.data.reservation ? (
          <Alert>
            You need a reservation for this seat before checking in.
          </Alert>
        ) : (
          <Card className="grid gap-3">
            <Title order={2}>{current.data.reservation.space.name}</Title>
            <Text>Seat {current.data.reservation.seat.label}</Text>
            <Text c="dimmed">
              {confirmed
                ? 'Check-in confirmed.'
                : 'Confirm your arrival. The server checks the seat and arrival deadline.'}
            </Text>
            {!confirmed && (
              <Button
                disabled={checkIn.isPending}
                onClick={() =>
                  checkIn.mutate(
                    { body: { qr_token: token } },
                    {
                      onSuccess: () => {
                        setConfirmed(true);
                        void cache.invalidateQueries();
                      },
                    },
                  )
                }
              >
                {checkIn.isPending ? 'Checking in…' : 'Check in'}
              </Button>
            )}
          </Card>
        )}
        {checkIn.isError && (
          <Alert variant="danger">{errorMessage(checkIn.error)}</Alert>
        )}
        <Button variant="secondary" component={Link} to="/">
          Back to home
        </Button>
      </ScreenMain>
    </Screen>
  );
}
