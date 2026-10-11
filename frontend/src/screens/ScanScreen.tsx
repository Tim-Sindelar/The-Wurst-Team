import { ActionIcon, Alert, Button, Text } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import {
  adminGetSeatOptions,
  checkInMutation,
  extendReservationMutation,
  returnFromBreakMutation,
  startBreakMutation,
} from '../api/generated/@tanstack/react-query.gen';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { apiProblem, type ApiProblem } from '../domain/booking';
import { qrTokenFrom } from '../domain/seatQr';
import { useMyReservation, useRefreshBooking } from '../hooks/useMyReservation';
import { useQrScanner } from '../hooks/useQrScanner';
import { paths } from '../routes';

/* Why the scan is happening (?from=), which changes the title, what happens
   after a good scan, and where the back arrow and a successful scan lead.
   Check-in is the default. Every flow sends the scanned code to the server,
   which checks it belongs to the reservation's own seat. */
type FlowKey = 'checkIn' | 'extend' | 'break-start' | 'break-end';

const flows: Record<
  FlowKey,
  {
    title: string;
    back: string;
    done: string;
    needs: ('pending' | 'active' | 'on_break')[];
  }
> = {
  checkIn: {
    title: 'Scan the QR code on your table',
    back: paths.reservation,
    done: paths.session,
    needs: ['pending'],
  },
  extend: {
    title: 'Scan the QR code to extend your session',
    back: paths.session,
    done: `${paths.session}?extended=1`,
    needs: ['active', 'on_break'],
  },
  'break-start': {
    title: 'Scan the QR code to start your break',
    back: paths.session,
    done: paths.session,
    needs: ['active'],
  },
  'break-end': {
    title: 'Scan the QR code to end your break',
    back: paths.session,
    done: paths.session,
    needs: ['on_break'],
  },
};

const isFlow = (value: string | null): value is FlowKey =>
  value !== null && value in flows;

export function ScanScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const from = params.get('from');
  const flowKey: FlowKey = isFlow(from) ? from : 'checkIn';
  const flow = flows[flowKey];

  const queryClient = useQueryClient();
  const refresh = useRefreshBooking();
  const { query, reservation, running } = useMyReservation();
  const checkIn = useMutation(checkInMutation());
  const extend = useMutation(extendReservationMutation());
  const startBreak = useMutation(startBreakMutation());
  const returnFromBreak = useMutation(returnFromBreakMutation());

  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  /* One attempt at a time: the camera reports the same code many times a
     second, and a failed scan stays locked until "Try again". */
  const locked = useRef(false);

  const submit = async (raw: string) => {
    const token = qrTokenFrom(raw);
    if (!token || locked.current) return;
    locked.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const body = { qr_token: token };
      if (flowKey === 'checkIn') {
        await checkIn.mutateAsync({ body });
      } else {
        if (!reservation) throw new Error('No reservation to scan for');
        const path = { reservation_id: reservation.id };
        const action = {
          extend,
          'break-start': startBreak,
          'break-end': returnFromBreak,
        }[flowKey];
        await action.mutateAsync({ path, body });
      }
      setLeaving(true);
      await refresh();
      navigate(flow.done, { replace: true });
    } catch (error) {
      setProblem(apiProblem(error));
      setBusy(false);
    }
  };

  /* Demo only: skip the camera by reading this seat's QR code through the
     demo admin stub, then go through the normal flow with it. */
  const skipScan = async () => {
    if (!reservation || locked.current) return;
    setBusy(true);
    setProblem(null);
    try {
      const { seat } = await queryClient.fetchQuery({
        ...adminGetSeatOptions({
          path: {
            space_id: reservation.space.id,
            seat_id: reservation.seat.id,
          },
          headers: { 'X-Demo-Admin': 'true' },
        }),
        staleTime: 0,
      });
      await submit(seat.qr_token);
    } catch (error) {
      setProblem(apiProblem(error));
      setBusy(false);
    }
  };

  const {
    videoRef,
    status: camera,
    hasFlash,
    flashOn,
    toggleFlash,
  } = useQrScanner((value) => void submit(value));

  const tryAgain = () => {
    locked.current = false;
    setProblem(null);
  };

  /* Send people away if there is nothing to scan for. */
  if (!leaving && query.data) {
    const status = reservation?.status;
    const fits =
      status !== undefined && flow.needs.some((need) => need === status);
    if (!fits) {
      return (
        <Navigate
          to={
            running && flowKey === 'checkIn' ? paths.session : paths.reservation
          }
          replace
        />
      );
    }
  }

  const wrongSeat =
    problem?.code === 'already_reserved' || problem?.code === 'wrong_seat';

  return (
    <Screen>
      {/* The camera fills the screen behind everything, dimmed except inside the scan frame. */}
      <div className="relative isolate flex flex-1 flex-col overflow-hidden bg-camera-bg text-camera-fg">
        <video
          ref={videoRef}
          className="absolute inset-0 -z-10 size-full object-cover"
          muted
          playsInline
          aria-hidden="true"
        />
        <div className="relative z-1 flex items-center justify-between p-2">
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
            aria-pressed={flashOn}
            aria-label="Flashlight"
            disabled={!hasFlash}
            onClick={() => void toggleFlash()}
          >
            <Icon name="flashlight" />
          </ActionIcon>
        </div>

        <div className="grid flex-1 place-content-center justify-items-center gap-4 px-4 text-center">
          <div
            className="relative block aspect-square w-[min(72vw,280px)] rounded-sheet border-3 border-camera-fg shadow-camera-dim after:absolute after:inset-0 after:animate-scan-line after:border-t-2 after:border-accent after:content-['']"
            role="img"
            aria-label="Camera view. Point it at the QR code on your table."
          />
          <div className="relative z-1 grid gap-2">
            <Text className="text-title">{flow.title}</Text>
            {reservation && (
              <Text size="sm" className="text-camera-fg/72">
                Seat {reservation.seat.label} · {reservation.space.name}
              </Text>
            )}
            {camera === 'starting' && (
              <Text size="sm" className="text-camera-fg/72" role="status">
                Starting the camera…
              </Text>
            )}
            {busy && (
              <Text size="sm" className="text-camera-fg/72" role="status">
                Checking the code…
              </Text>
            )}
          </div>
        </div>

        <div className="relative z-1 grid gap-3 px-4 pt-4 pb-[calc(--spacing(4)+env(safe-area-inset-bottom))] text-center">
          {problem && (
            <Alert
              variant="danger"
              role="alert"
              className="text-left"
              icon={<Icon name="alert" />}
              title={
                wrongSeat
                  ? "You don't seem to be at this seat"
                  : "That didn't work"
              }
            >
              <Text size="sm" c="dimmed">
                {wrongSeat && reservation
                  ? `Move closer to seat ${reservation.seat.label} and try again.`
                  : problem.message}
              </Text>
              <div className="mt-2">
                <Button variant="secondary" onClick={tryAgain}>
                  Try again
                </Button>
              </div>
            </Alert>
          )}
          {camera === 'unavailable' && !problem && (
            <Alert
              variant="warning"
              className="text-left"
              icon={<Icon name="alert" />}
              title="Camera not available"
            >
              <Text size="sm" c="dimmed">
                Allow camera access in your browser settings, then reload this
                page.
              </Text>
            </Alert>
          )}
          {import.meta.env.DEV && (
            <Button
              variant="quiet"
              disabled={busy || problem !== null || !reservation}
              onClick={() => void skipScan()}
            >
              Skip scan (demo only)
            </Button>
          )}
        </div>
      </div>
    </Screen>
  );
}
