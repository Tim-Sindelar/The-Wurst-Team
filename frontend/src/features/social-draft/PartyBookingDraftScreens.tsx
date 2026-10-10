import { Alert, Button, Card, NativeSelect, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { DecisionSheet } from '../../components/DecisionSheet';
import { Icon } from '../../components/Icon';
import { SectionLabel } from '../../components/SectionLabel';
import { SeatChip } from '../../components/SeatChip';
import { SeatMap } from '../../components/seat-map/SeatMap';
import { TimerCard } from '../../components/TimerCard';
import { stripeClass } from '../../domain/seat';
import { useCountdown } from '../../hooks/useCountdown';
import { mockSpace, roomSeats } from '../../mock/data';
import { partyPath, holdSeconds, sessionSeconds } from './draft';
import { DraftFrame } from './SocialDraftLayout';
import { useSocialDraft } from './useSocialDraft';

export function PartySeatsDraftScreen() {
  const { state, dispatch } = useSocialDraft();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const members = state.party.members.filter((m) => m.status === 'accepted');
  const [active, setActive] = useState(members[0]?.person.id ?? 'you');
  const [assignments, setAssignments] = useState<Record<string, number>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState('');
  const person = members.find((m) => m.person.id === active)?.person;
  const picked = Object.values(assignments);
  const complete = members.every((m) => !!assignments[m.person.id]);
  const allowed =
    state.viewer === state.party.organizerId && state.party.status === 'open';

  const choose = (number: number) => {
    const seat = roomSeats.find((s) => s.number === number);
    if (seat?.state !== 'free') {
      setError('Choose a seat that is free right now.');
      return;
    }
    if (
      Object.entries(assignments).some(
        ([id, n]) => n === number && id !== active,
      )
    ) {
      setError(`Seat ${number} is already assigned. Choose another free seat.`);
      return;
    }
    setAssignments((value) => ({ ...value, [active]: number }));
    setError('');
    const next = members.find(
      (m) => m.person.id !== active && !assignments[m.person.id],
    );
    if (next) setActive(next.person.id);
  };

  return (
    <DraftFrame
      title="Choose party seats"
      backTo={partyPath(state.party.id)}
      actions={
        allowed ? (
          <Button disabled={!complete} onClick={() => setSheetOpen(true)}>
            {complete
              ? `Reserve ${members.length} seats together`
              : `Choose ${members.length - picked.length} more ${members.length - picked.length === 1 ? 'seat' : 'seats'}`}
          </Button>
        ) : (
          <Button component={Link} to={partyPath(state.party.id)}>
            Back to party
          </Button>
        )
      }
    >
      {!allowed ? (
        <Alert title="Seat selection unavailable">
          Only the organizer can book seats for an open party.
        </Alert>
      ) : (
        <>
          <div className="grid gap-2">
            <Title order={2} className="text-heading">
              {mockSpace.name}
            </Title>
            <Text size="sm" c="dimmed">
              {state.party.name} · {members.length} ready members ·{' '}
              {picked.length} seats chosen
            </Text>
          </div>
          <NativeSelect
            label="Choose a seat for"
            value={active}
            data={members.map((m) => ({
              value: m.person.id,
              label: m.person.id === state.viewer ? 'You' : m.person.name,
            }))}
            rightSection={<Icon name="back" size="sm" className="-rotate-90" />}
            onChange={(e) => {
              setActive(e.currentTarget.value);
              setError('');
            }}
          />
          <Text size="sm" c="dimmed">
            Tap a free seat for{' '}
            {active === state.viewer ? 'yourself' : person?.name}. Choose seats
            close to each other.
          </Text>
          <SeatMap
            seats={roomSeats}
            selected={assignments[active] ?? 0}
            highlightedSeats={picked}
            onSelect={choose}
          />
          {error && (
            <Alert
              variant="danger"
              role="alert"
              title="Unable to reserve these seats"
            >
              {error}
            </Alert>
          )}
          <SectionLabel>Seat assignments</SectionLabel>
          {members.map((m) => (
            <Card
              key={m.person.id}
              component="article"
              aria-label={`${m.person.name}, ${assignments[m.person.id] ? `seat ${assignments[m.person.id]}` : 'no seat chosen'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="grid min-w-0 gap-1">
                  <Text className="break-words">
                    {m.person.id === state.viewer ? 'You' : m.person.name}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {assignments[m.person.id]
                      ? `Seat ${assignments[m.person.id]}`
                      : 'Choose a seat'}
                  </Text>
                </div>
                <Button
                  variant="quiet"
                  aria-label={`Change seat for ${m.person.name}`}
                  onClick={() => setActive(m.person.id)}
                >
                  {active === m.person.id ? 'Choosing' : 'Change'}
                </Button>
              </div>
            </Card>
          ))}
          <Text size="sm" c="dimmed">
            Only free seats in this room can be selected. Everyone gets a seat
            together, or none are booked.
          </Text>
        </>
      )}
      <DecisionSheet
        opened={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={`Reserve ${members.length} seats together?`}
        safeLabel="Keep choosing"
        actionLabel="Reserve seats"
        onConfirm={() => {
          setSheetOpen(false);
          if (!allowed || !complete) return;
          if (params.get('error') === '1') {
            setError(
              'One of the seats was just taken. Your party has no new reservations. Choose seats again.',
            );
            return;
          }
          dispatch({ type: 'book', assignments, now: Date.now() });
          navigate(partyPath(state.party.id, 'reservation'));
        }}
      >
        {mockSpace.name}. Seats {picked.join(', ')} for {members.length}{' '}
        members. Each person must check in within 15 minutes. Pending
        invitations won’t be included.
      </DecisionSheet>
    </DraftFrame>
  );
}

export function PartyReservationDraftScreen() {
  const { state } = useSocialDraft();
  return <ReservationPreview key={`${state.viewer}:${state.party.bookedAt}`} />;
}

function ReservationPreview() {
  const { state, dispatch } = useSocialDraft();
  const [cancelOpen, setCancelOpen] = useState(false);
  const member = state.party.members.find((m) => m.person.id === state.viewer);
  const [remaining] = useState(() =>
    Math.max(
      0,
      holdSeconds -
        Math.floor((Date.now() - (state.party.bookedAt ?? Date.now())) / 1000),
    ),
  );
  const [sessionRemaining] = useState(() =>
    Math.max(
      0,
      sessionSeconds -
        Math.floor((Date.now() - (state.party.bookedAt ?? Date.now())) / 1000),
    ),
  );
  const left = useCountdown(remaining);
  const expired = !member?.checkedIn && left === 0;
  const available = !!member?.seat && !member.cancelled && !expired;
  const ready = state.party.members.filter((m) => m.seat && !m.cancelled);
  const checkedIn = ready.filter((m) => m.checkedIn).length;

  return (
    <DraftFrame
      title={
        member?.checkedIn ? 'Your party session' : 'Your party reservation'
      }
      backTo={partyPath(state.party.id)}
      actions={
        available ? (
          <>
            {member.checkedIn ? (
              <Button component={Link} to={partyPath(state.party.id)}>
                View party
              </Button>
            ) : (
              <Button
                component={Link}
                to={partyPath(state.party.id, 'scan')}
                leftSection={<Icon name="qr" />}
              >
                Check in at my seat
              </Button>
            )}
            <Button variant="secondary" onClick={() => setCancelOpen(true)}>
              {member.checkedIn ? 'End my session' : 'Cancel my seat'}
            </Button>
          </>
        ) : (
          <Button component={Link} to={partyPath(state.party.id)}>
            Back to party
          </Button>
        )
      }
    >
      {!available ? (
        <Alert
          title={expired ? 'Check-in time expired' : 'No seat reserved for you'}
        >
          {expired
            ? 'Your seat has been released. Other party members keep their reservations.'
            : 'You weren’t included in this booking, or your seat has been cancelled.'}
        </Alert>
      ) : (
        <>
          <Card
            component="section"
            className={
              member.checkedIn ? stripeClass.yours : stripeClass.reserved
            }
            aria-label="Your assigned seat"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Title order={2} className="text-heading">
                Seat {member.seat}
              </Title>
              <SeatChip state={member.checkedIn ? 'yours' : 'reserved'} plain />
            </div>
            <Text c="dimmed" className="flex items-center gap-2">
              <Icon name="pin" size="sm" />
              {mockSpace.name} · {mockSpace.building}
            </Text>
            <Text size="sm">Booked with {state.party.name}</Text>
          </Card>
          <TimerCard
            label={member.checkedIn ? 'Session time left' : 'Check in within'}
            seconds={member.checkedIn ? sessionRemaining : remaining}
            total={member.checkedIn ? sessionSeconds : holdSeconds}
          >
            <Text size="sm" c="dimmed">
              {member.checkedIn
                ? 'You’re checked in. Your session is yours to manage independently.'
                : `Scan the QR code at seat ${member.seat} when you arrive. You can’t check in for someone else.`}
            </Text>
          </TimerCard>
        </>
      )}
      <SectionLabel>
        Your party · {checkedIn} of {ready.length} checked in
      </SectionLabel>
      {ready.map((m) => (
        <Card key={m.person.id}>
          <div className="flex items-start gap-3">
            <Icon name={m.checkedIn ? 'check' : 'clock'} size="sm" />
            <div className="grid min-w-0 gap-1">
              <Text className="break-words">
                {m.person.id === state.viewer ? 'You' : m.person.name}
              </Text>
              <Text size="sm" c="dimmed">
                Seat {m.seat} ·{' '}
                {m.checkedIn ? 'Checked in' : 'Waiting for check-in'}
              </Text>
            </div>
          </div>
        </Card>
      ))}
      <Text size="sm" c="dimmed">
        One member missing check-in only releases their own seat.
      </Text>
      <DecisionSheet
        opened={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={member?.checkedIn ? 'End your session?' : 'Cancel your seat?'}
        safeLabel="Keep seat"
        actionLabel={member?.checkedIn ? 'End session' : 'Cancel my seat'}
        actionTone="danger"
        onConfirm={() => {
          dispatch({ type: 'cancel-seat' });
          setCancelOpen(false);
        }}
      >
        Your seat becomes free. Other party members keep their seats.
      </DecisionSheet>
    </DraftFrame>
  );
}

export function PartyScanDraftScreen() {
  const { state, dispatch } = useSocialDraft();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const member = state.party.members.find((m) => m.person.id === state.viewer);
  const allowed = !!member?.seat && !member.cancelled && !member.checkedIn;
  return (
    <DraftFrame
      title="Scan your seat"
      backTo={partyPath(state.party.id, 'reservation')}
    >
      {allowed ? (
        <>
          <Text>Scan the QR code at seat {member.seat}.</Text>
          <Text size="sm" c="dimmed">
            {mockSpace.name} · Your own check-in
          </Text>
          <button
            type="button"
            aria-label="Scan frame. Activate to simulate scanning your assigned seat"
            className="mx-auto grid aspect-square w-60 place-items-center rounded-sheet border-2 border-camera-fg bg-camera-bg text-camera-fg"
            onClick={() => {
              if (
                !state.party.bookedAt ||
                Date.now() >= state.party.bookedAt + holdSeconds * 1000
              ) {
                setError(
                  'Your check-in time expired. Your seat has been released.',
                );
                return;
              }
              dispatch({ type: 'check-in' });
              navigate(partyPath(state.party.id, 'reservation'));
            }}
          >
            <Icon name="qr" size="lg" />
          </button>
          <Text size="sm" c="dimmed">
            Preview: tap the frame to simulate your scan.
          </Text>
        </>
      ) : (
        <Alert title="No seat to check in">
          Your reservation is unavailable or you already checked in.
        </Alert>
      )}
      {error && (
        <Alert variant="danger" role="alert" title="Unable to check in">
          {error}
        </Alert>
      )}
    </DraftFrame>
  );
}
