import { Alert, Button, Card, Text, Title } from '@mantine/core';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { endReservationMutation } from '../api/generated/@tanstack/react-query.gen';
import { DecisionSheet } from '../components/DecisionSheet';
import { Icon } from '../components/Icon';
import {
  ActionBar,
  Screen,
  ScreenHeader,
  ScreenMain,
} from '../components/Screen';
import { SeatChip } from '../components/SeatChip';
import { StatusBanner } from '../components/StatusBanner';
import { TimerCard } from '../components/TimerCard';
import { apiProblem, secondsBetween } from '../domain/booking';
import { stripeClass } from '../domain/seat';
import {
  useMyReservation,
  useRefetchAt,
  useRefreshBooking,
} from '../hooks/useMyReservation';
import { useNow } from '../hooks/useNow';
import { useRules } from '../hooks/useRules';
import { paths } from '../routes';

type Sheet = 'extend' | 'break' | 'end' | null;

const header = (
  <ScreenHeader
    title="Your session"
    backTo={paths.home}
    backLabel="Back to home"
  />
);

export function SessionScreen() {
  const navigate = useNavigate();
  const refresh = useRefreshBooking();
  const { query, running, toClient } = useMyReservation();
  const now = useNow();
  const { query: rulesQuery, rules } = useRules();
  const end = useMutation(endReservationMutation());
  const [params, setParams] = useSearchParams();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [leaving, setLeaving] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(params.get('extended') === '1');
  const closeBanner = useCallback(() => setBannerOpen(false), []);

  /* The banner is shown once: drop ?extended=1 so a reload doesn't repeat it. */
  useEffect(() => {
    if (params.has('extended')) setParams({}, { replace: true });
  }, [params, setParams]);

  const onBreak = running?.status === 'on_break';
  const sessionEnd = running ? toClient(running.ends_at) : null;
  const breakEnd =
    onBreak && running.current_break
      ? toClient(running.current_break.ends_at)
      : null;
  const { refetch } = query;
  useRefetchAt(sessionEnd, refetch);
  useRefetchAt(breakEnd, refetch);

  if (query.isError || rulesQuery.isError) {
    return (
      <Screen>
        {header}
        <ScreenMain>
          <Alert
            variant="danger"
            role="alert"
            icon={<Icon name="alert" />}
            title="Couldn't load your session"
          >
            <Text size="sm">Check your connection and try again.</Text>
          </Alert>
        </ScreenMain>
        <ActionBar>
          <Button
            fullWidth
            onClick={() => {
              void refetch();
              void rulesQuery.refetch();
            }}
          >
            Try again
          </Button>
        </ActionBar>
      </Screen>
    );
  }

  if (!query.data || !rules) {
    return (
      <Screen>
        {header}
        <ScreenMain>
          <Text c="dimmed" role="status">
            Loading your session…
          </Text>
        </ScreenMain>
      </Screen>
    );
  }

  /* No running session: a held seat still has to be checked in, anything else
     shows the "no reservation" notice there. */
  if (!running || sessionEnd === null) {
    return leaving ? null : <Navigate to={paths.reservation} replace />;
  }

  const actions = running.available_actions;
  const secondsLeft = Math.max(0, Math.round((sessionEnd - now) / 1000));
  const extensionOpen = actions.includes('extend');
  /* In the last public-window minutes anyone can book the next session. */
  const othersCanBook =
    secondsLeft <= rules.public_reservation_window_minutes * 60;
  const canBreak = actions.includes('start_break');
  const breakMinutes = Math.floor(running.break_seconds_remaining / 60);
  const endsAt = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(sessionEnd));

  const endSession = () =>
    end.mutate(
      { path: { reservation_id: running.id } },
      {
        onSuccess: async () => {
          setLeaving(true);
          await refresh();
          navigate(paths.home);
        },
      },
    );

  const closeSheet = () => {
    setSheet(null);
    end.reset();
  };

  return (
    <Screen>
      {header}

      <ScreenMain>
        {extensionOpen && !othersCanBook && (
          <Alert icon={<Icon name="clock" />} title="Priority extension">
            <Text size="sm" c="dimmed">
              Only you can extend for the next{' '}
              {rules.private_priority_window_minutes -
                rules.public_reservation_window_minutes}{' '}
              minutes.
            </Text>
            <div className="mt-2">
              <Button onClick={() => setSheet('extend')}>Extend session</Button>
            </div>
          </Alert>
        )}
        {extensionOpen && othersCanBook && (
          <Alert
            variant="warning"
            icon={<Icon name="alert" />}
            title="Others can reserve this seat now"
          >
            <Text size="sm" c="dimmed">
              Extend before someone books it. If they do, you'll have to leave
              when your time is up.
            </Text>
            <div className="mt-2">
              <Button onClick={() => setSheet('extend')}>Extend session</Button>
            </div>
          </Alert>
        )}

        <Card
          component="section"
          className={onBreak ? stripeClass.break : stripeClass.yours}
          aria-labelledby="seat-title"
        >
          <div className="flex items-center justify-between gap-2">
            <Title order={2} id="seat-title" className="text-heading">
              Seat {running.seat.label}
            </Title>
            {onBreak ? (
              <SeatChip state="break" />
            ) : (
              <SeatChip state="yours" plain>
                In session
              </SeatChip>
            )}
          </div>
          <Text c="dimmed" className="flex items-center gap-2">
            <Icon name="pin" size="sm" /> {running.space.name}
          </Text>
        </Card>

        {/* Break timer: only on break. The session clock keeps running below. */}
        {onBreak && breakEnd !== null && running.current_break && (
          <TimerCard
            label="Break ends in"
            seconds={Math.max(
              1,
              secondsBetween(
                running.current_break.started_at,
                running.current_break.ends_at,
              ),
            )}
            expiresAt={breakEnd}
            total={Math.max(
              1,
              secondsBetween(
                running.current_break.started_at,
                running.current_break.ends_at,
              ),
            )}
            stripe="break"
          >
            <Text size="sm" c="dimmed">
              Your seat is held for you. Your session time keeps running.
            </Text>
            <Button
              component={Link}
              to={`${paths.scan}?from=break-end`}
              fullWidth
              leftSection={<Icon name="qr" />}
            >
              Back at my seat
            </Button>
          </TimerCard>
        )}

        <TimerCard
          label="Session time left"
          seconds={Math.max(
            1,
            secondsBetween(
              running.checked_in_at ?? running.starts_at,
              running.ends_at,
            ),
          )}
          expiresAt={sessionEnd}
          total={Math.max(
            1,
            secondsBetween(
              running.checked_in_at ?? running.starts_at,
              running.ends_at,
            ),
          )}
        >
          <Text size="sm" c="dimmed">
            Ends at {endsAt}.
          </Text>
        </TimerCard>
      </ScreenMain>

      <ActionBar>
        {onBreak ? (
          <Button variant="danger" fullWidth onClick={() => setSheet('end')}>
            End session
          </Button>
        ) : (
          <div className="ui-button-row flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={!canBreak}
              leftSection={<Icon name="coffee" />}
              onClick={() => setSheet('break')}
            >
              {canBreak ? 'Take a break' : 'No break time left'}
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={() => setSheet('end')}
            >
              End session
            </Button>
          </div>
        )}
      </ActionBar>

      <DecisionSheet
        opened={sheet === 'extend'}
        onClose={closeSheet}
        title="Extend your session?"
        safeLabel="Not now"
        actionLabel="Extend session"
        onConfirm={() => navigate(`${paths.scan}?from=extend`)}
      >
        Adds {rules.session_length_minutes / 60} hours, or less if the room
        closes sooner. You'll scan the QR code again to confirm you're still at
        your seat.
      </DecisionSheet>

      <DecisionSheet
        opened={sheet === 'break'}
        onClose={closeSheet}
        title="Take a break?"
        safeLabel="Stay"
        actionLabel="Start break"
        onConfirm={() => navigate(`${paths.scan}?from=break-start`)}
      >
        Your seat is held for up to {breakMinutes} minutes. Your session time
        keeps running. You scan the QR code to start and to end your break.
      </DecisionSheet>

      <DecisionSheet
        opened={sheet === 'end'}
        onClose={closeSheet}
        title="End session?"
        safeLabel="Keep going"
        actionLabel="End session"
        actionTone="danger"
        onConfirm={endSession}
      >
        {end.isError
          ? apiProblem(end.error).message
          : `Seat ${running.seat.label} is freed for others. You can't undo this.`}
      </DecisionSheet>

      <StatusBanner
        opened={bannerOpen}
        onClose={closeBanner}
        icon="check"
        title="Session extended"
      >
        Your session now ends at {endsAt}.
      </StatusBanner>
    </Screen>
  );
}
