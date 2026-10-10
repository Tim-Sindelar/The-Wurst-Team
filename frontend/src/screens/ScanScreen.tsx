import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { mockSpace } from '../mock/data';
import { useMockBooking } from '../mock/useMockBooking';
import { paths } from '../routes';

/* Why the scan is happening (?from=), which changes the title and where the
   back arrow and a successful scan lead. Check-in is the default. */
const flows = {
  checkIn: {
    title: 'Scan the QR code on your table',
    back: paths.reservation,
    done: paths.session,
  },
  extend: {
    title: 'Scan the QR code to extend your session',
    back: paths.session,
    done: `${paths.session}?extended=1`,
  },
  'break-start': {
    title: 'Scan the QR code to start your break',
    back: paths.session,
    done: `${paths.session}?phase=break`,
  },
  'break-end': {
    title: 'Scan the QR code to end your break',
    back: `${paths.session}?phase=break`,
    done: paths.session,
  },
};

const isFlow = (value: string | null): value is keyof typeof flows =>
  value !== null && value in flows;

export function ScanScreen() {
  const { seat, booking } = useMockBooking();
  const [params] = useSearchParams();
  const [flashlight, setFlashlight] = useState(false);
  const from = params.get('from');
  const flow = flows[isFlow(from) ? from : 'checkIn'];
  const showError = params.get('error') === '1';

  /* Keep ?from= when switching between the normal and error state. */
  const scanUrl = (error: boolean) => {
    const next = new URLSearchParams();
    if (from) next.set('from', from);
    if (error) next.set('error', '1');
    const query = next.toString();
    return query ? `${paths.scan}?${query}` : paths.scan;
  };

  if (flow === flows.checkIn && booking !== 'reserved')
    return <Navigate to={paths.reservation} replace />;

  return (
    <Screen>
      <div className="relative flex flex-1 flex-col bg-camera-bg text-camera-fg">
        <div className="flex items-center justify-between p-2">
          <ActionIcon
            variant="camera"
            component={Link}
            to={flow.back}
            aria-label="Back"
          >
            <Icon name="back" />
          </ActionIcon>
          <h1 className="sr-only">Scan QR code</h1>
          <ActionIcon
            variant="camera"
            aria-pressed={flashlight}
            aria-label="Flashlight"
            onClick={() => setFlashlight((on) => !on)}
          >
            <Icon name="flashlight" />
          </ActionIcon>
        </div>

        <div className="grid flex-1 place-content-center justify-items-center gap-4 px-4 text-center">
          {/* Mock: tapping the frame counts as a successful scan. */}
          <UnstyledButton
            component={Link}
            to={flow.done}
            className="relative block aspect-square w-[min(72vw,280px)] overflow-hidden rounded-sheet border-3 border-camera-fg after:absolute after:inset-0 after:animate-scan-line after:border-t-2 after:border-accent after:content-['']"
            aria-label="Scan frame. Activate to simulate scanning the QR code on your table"
          />
          <div className="grid gap-2">
            <Text className="text-title">{flow.title}</Text>
            <Text size="sm" className="text-camera-fg/72">
              Seat {seat} · {mockSpace.name}
            </Text>
          </div>
        </div>

        <div className="grid gap-3 px-4 pt-4 pb-[calc(--spacing(4)+env(safe-area-inset-bottom))] text-center">
          {showError && (
            <Alert
              variant="danger"
              role="alert"
              className="text-left"
              icon={<Icon name="alert" />}
              title="You don't seem to be at this seat"
            >
              <Text size="sm" c="dimmed">
                Move closer to seat {seat} and try again.
              </Text>
              <div className="mt-2">
                <Button
                  variant="secondary"
                  component={Link}
                  to={scanUrl(false)}
                >
                  Try again
                </Button>
              </div>
            </Alert>
          )}
          <Text size="sm" className="text-camera-fg/72">
            Mock: tap the frame to scan ·{' '}
            <Anchor
              component={Link}
              to={scanUrl(true)}
              className="text-inherit"
            >
              show the error state
            </Anchor>
          </Text>
        </div>
      </div>
    </Screen>
  );
}
