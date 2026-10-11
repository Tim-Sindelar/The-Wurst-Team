import { Alert, Button, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useSearchParams } from 'react-router';
import { findSeatByQrOptions } from '../api/generated/@tanstack/react-query.gen';
import { Icon } from '../components/Icon';
import {
  ActionBar,
  Screen,
  ScreenHeader,
  ScreenMain,
} from '../components/Screen';
import { apiProblem } from '../domain/booking';
import { paths, seatMapPath } from '../routes';

/** A seat's QR code link (/qr?qr_token=): opens that seat's seat map with
    the seat selected, ready to reserve. */
export function SeatQrScreen() {
  const [params] = useSearchParams();
  const token = params.get('qr_token')?.trim() ?? '';
  const seat = useQuery({
    ...findSeatByQrOptions({ query: { qr_token: token } }),
    enabled: token !== '',
    retry: false,
  });

  if (seat.data)
    return (
      <Navigate
        replace
        to={`${seatMapPath(seat.data.space_id)}?seat=${encodeURIComponent(seat.data.seat_id)}`}
      />
    );

  const missing =
    token === '' ||
    (seat.isError && apiProblem(seat.error).code === 'qr_not_found');

  return (
    <Screen>
      <ScreenHeader title="Seat" backTo={paths.home} backLabel="Back to home" />
      <ScreenMain>
        {seat.isError || missing ? (
          <Alert
            variant="danger"
            role="alert"
            icon={<Icon name="alert" />}
            title={missing ? 'Unknown seat code' : "Couldn't open this seat"}
          >
            <Text size="sm">
              {missing
                ? "This QR code doesn't belong to a seat."
                : apiProblem(seat.error).message}
            </Text>
          </Alert>
        ) : (
          <Text c="dimmed" role="status">
            Opening the seat…
          </Text>
        )}
      </ScreenMain>
      {(seat.isError || missing) && (
        <ActionBar>
          {missing ? (
            <Button component={Link} to={paths.home} fullWidth>
              Choose a study space
            </Button>
          ) : (
            <Button fullWidth onClick={() => void seat.refetch()}>
              Try again
            </Button>
          )}
        </ActionBar>
      )}
    </Screen>
  );
}
