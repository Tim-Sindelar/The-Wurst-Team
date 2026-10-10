import { Alert, Anchor, Button, Card, Text, Title } from '@mantine/core';
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
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
import { stripeClass } from '../domain/seat';
import { mockRules, mockSpace } from '../mock/data';
import { useMockBooking } from '../mock/useMockBooking';
import { paths } from '../routes';

/* Mock phases, picked with ?phase=. Priority = 20 min left (only you can
   extend), open = 10 min left (anyone can book), break = you're away. */
type Phase = 'normal' | 'priority' | 'open' | 'break';
const phases: Phase[] = ['normal', 'priority', 'open', 'break'];

/** Session seconds left shown in each phase. */
const sessionLeft: Record<Phase, number> = {
  normal: 6761,
  priority: 1160,
  open: 570,
  break: 6761,
};

type Sheet = 'extend' | 'break' | 'end' | null;

export function SessionScreen() {
  const navigate = useNavigate();
  const { seat, booking, setBooking } = useMockBooking();
  const [params] = useSearchParams();
  const phaseParam = params.get('phase') as Phase | null;
  const phase: Phase =
    phaseParam && phases.includes(phaseParam) ? phaseParam : 'normal';
  const extended = params.get('extended') === '1';
  const [sheet, setSheet] = useState<Sheet>(null);
  const [bannerOpen, setBannerOpen] = useState(extended);
  const closeBanner = useCallback(() => setBannerOpen(false), []);

  /* Opening this screen means a session is running (mock). */
  useEffect(() => setBooking('session'), [setBooking]);

  const onBreak = phase === 'break';
  const timeLeft = extended ? 8360 : sessionLeft[phase];
  const timeTotal = extended
    ? mockRules.sessionSeconds * 2
    : mockRules.sessionSeconds;
  const breakMinutes = mockRules.breakSeconds / 60;

  const endSession = () => {
    setBooking('none');
    navigate(paths.home);
  };

  if (booking === 'none') return <Navigate to={paths.reservation} replace />;

  return (
    <Screen>
      <ScreenHeader
        title="Your session"
        backTo={paths.home}
        backLabel="Back to home"
      />

      <ScreenMain>
        {/* Phase notices: only in the two extension phases. */}
        {phase === 'priority' && (
          <Alert icon={<Icon name="clock" />} title="Priority extension">
            <Text size="sm" c="dimmed">
              Only you can extend for the next 10 minutes.
            </Text>
            <div className="mt-2">
              <Button onClick={() => setSheet('extend')}>Extend session</Button>
            </div>
          </Alert>
        )}
        {phase === 'open' && (
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
              Seat {seat}
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
            <Icon name="pin" size="sm" /> {mockSpace.name} ·{' '}
            {mockSpace.building}
          </Text>
        </Card>

        {/* Break timer: only on break. The session clock keeps running below. */}
        {onBreak && (
          <TimerCard
            label="Break ends in"
            seconds={870}
            total={mockRules.breakSeconds}
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
          key={`${phase}-${extended}`}
          label="Session time left"
          seconds={timeLeft}
          total={timeTotal}
        />

        <Text size="sm" c="dimmed">
          Mock:{' '}
          <Anchor component={Link} to={paths.session}>
            normal
          </Anchor>{' '}
          ·{' '}
          <Anchor component={Link} to={`${paths.session}?phase=priority`}>
            20 min left
          </Anchor>{' '}
          ·{' '}
          <Anchor component={Link} to={`${paths.session}?phase=open`}>
            10 min left
          </Anchor>{' '}
          ·{' '}
          <Anchor component={Link} to={`${paths.session}?phase=break`}>
            on break
          </Anchor>
        </Text>
      </ScreenMain>

      <ActionBar>
        {onBreak ? (
          <Button variant="danger" fullWidth onClick={() => setSheet('end')}>
            End session
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              leftSection={<Icon name="coffee" />}
              onClick={() => setSheet('break')}
            >
              Take a break
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
        onClose={() => setSheet(null)}
        title="Extend your session?"
        safeLabel="Not now"
        actionLabel="Extend session"
        onConfirm={() => navigate(`${paths.scan}?from=extend`)}
      >
        Adds 2 hours. You'll scan the QR code again to confirm you're still at
        your seat.
      </DecisionSheet>

      <DecisionSheet
        opened={sheet === 'break'}
        onClose={() => setSheet(null)}
        title="Take a break?"
        safeLabel="Stay"
        actionLabel="Start break"
        onConfirm={() => navigate(`${paths.scan}?from=break-start`)}
      >
        Your seat is held for {breakMinutes} minutes. Your session time keeps
        running. You scan the QR code to start and to end your break.
      </DecisionSheet>

      <DecisionSheet
        opened={sheet === 'end'}
        onClose={() => setSheet(null)}
        title="End session?"
        safeLabel="Keep going"
        actionLabel="End session"
        actionTone="danger"
        onConfirm={endSession}
      >
        Seat {seat} is freed for others. You can't undo this.
      </DecisionSheet>

      <StatusBanner
        opened={bannerOpen}
        onClose={closeBanner}
        icon="check"
        title="Session extended"
      >
        You have 2 more hours.
      </StatusBanner>
    </Screen>
  );
}
