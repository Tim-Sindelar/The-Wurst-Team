import { Alert, Button, Card, NativeSelect, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  getSpaceOptions,
  listSpacesOptions,
} from '../../api/generated/@tanstack/react-query.gen';
import { DecisionSheet } from '../../components/DecisionSheet';
import { Icon } from '../../components/Icon';
import { SectionLabel } from '../../components/SectionLabel';
import { SeatMap } from '../../components/seat-map/SeatMap';
import { apiProblem } from '../../domain/booking';
import { layoutSeats } from '../../domain/room';
import { savedLayout } from '../admin/layoutDocument';
import { useRules } from '../../hooks/useRules';
import { paths } from '../../routes';
import { draftPaths, partyPath } from './draft';
import { LivePartyNotice } from './LivePartyScreens';
import { DraftFrame } from './SocialDraftLayout';
import { useParties, usePartyActions } from './useParties';

export function LivePartySeatsScreen() {
  const social = useParties();
  const action = usePartyActions();
  const navigate = useNavigate();
  const { rules, query: rulesQuery } = useRules();
  const spacesQuery = useQuery({
    ...listSpacesOptions(),
    refetchInterval: 15000,
  });
  const [chosenRoom, setChosenRoom] = useState('');
  const [active, setActive] = useState('');
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [sheet, setSheet] = useState(false);
  const [selectionError, setSelectionError] = useState('');
  const party = social.party;
  const members = party?.members.filter((m) => m.status === 'accepted') ?? [];
  const spaces = spacesQuery.data?.spaces ?? [];
  const roomId =
    chosenRoom ||
    spaces.find((s) => s.is_open && s.free_seats >= members.length)?.id ||
    spaces[0]?.id ||
    '';
  const spaceQuery = useQuery({
    ...getSpaceOptions({ path: { space_id: roomId } }),
    enabled: !!roomId,
    refetchInterval: 15000,
  });
  const space = spaceQuery.data?.space;
  const {
    plan,
    shown: seats,
    hidden,
  } = layoutSeats(space?.seats ?? [], null, savedLayout(space?.layout));
  const activeId = members.some((m) => m.person.id === active)
    ? active
    : (members.find((m) => !assignments[m.person.id])?.person.id ??
      members[0]?.person.id ??
      '');
  const freeIds = new Set(
    space?.seats
      .filter((s) => s.is_active && s.state === 'free')
      .map((s) => s.id),
  );
  const picked = members.map((m) => assignments[m.person.id]).filter(Boolean);
  const complete =
    members.length > 0 &&
    members.every((m) => freeIds.has(assignments[m.person.id])) &&
    new Set(picked).size === members.length;
  const allowed =
    party?.organizer_id === social.user?.id && party?.status === 'open';
  const queryError = spacesQuery.error || spaceQuery.error || rulesQuery.error;
  const error =
    action.error ||
    selectionError ||
    (queryError ? apiProblem(queryError).message : '');
  const choose = (id: string) => {
    if (!allowed || action.busy || !activeId) return;
    if (!freeIds.has(id)) {
      setSelectionError('Choose a seat that is free right now.');
      return;
    }
    if (
      members.some(
        (m) => m.person.id !== activeId && assignments[m.person.id] === id,
      )
    ) {
      setSelectionError(
        'That seat is already assigned. Choose another free seat.',
      );
      return;
    }
    setAssignments((previous) => ({ ...previous, [activeId]: id }));
    setSelectionError('');
    const next = members.find(
      (m) => m.person.id !== activeId && !assignments[m.person.id],
    );
    if (next) setActive(next.person.id);
  };
  return (
    <DraftFrame
      title="Choose party seats"
      backTo={party ? partyPath(party.id) : draftPaths.parties}
      actions={
        allowed ? (
          <Button
            disabled={
              !complete ||
              !rules ||
              !!queryError ||
              social.loading ||
              !!social.error ||
              action.busy ||
              !space?.is_open
            }
            loading={action.busy}
            onClick={() => setSheet(true)}
          >
            Reserve {members.length} seats together
          </Button>
        ) : (
          <Button
            component={Link}
            to={party ? partyPath(party.id) : draftPaths.parties}
          >
            Back to party
          </Button>
        )
      }
    >
      <LivePartyNotice social={social} />
      {error && (
        <Alert
          variant="danger"
          role="alert"
          title="Unable to reserve these seats"
        >
          {error}
        </Alert>
      )}
      {!social.loading && party && !allowed && (
        <Alert title="Seat selection unavailable">
          Only the organizer can book seats for an open party.
        </Alert>
      )}
      {allowed && (
        <>
          <Text c="dimmed">
            Choose a room, then assign one free seat to each person who joined.
            Everyone checks in individually.
          </Text>
          {spacesQuery.isPending ? (
            <Text role="status" c="dimmed">
              Loading study spaces…
            </Text>
          ) : !spaces.length && !spacesQuery.isError ? (
            <Alert title="No study spaces available">
              Try again once a study space is available for booking.
            </Alert>
          ) : (
            <NativeSelect
              label="Study space"
              value={roomId}
              data={spaces.map((s) => ({
                value: s.id,
                label: `${s.name} · ${s.free_seats} free${s.is_open ? '' : ' · closed'}`,
              }))}
              disabled={action.busy}
              rightSection={
                <Icon name="back" size="sm" className="-rotate-90" />
              }
              onChange={(e) => {
                setChosenRoom(e.currentTarget.value);
                setAssignments({});
                setSelectionError('');
              }}
            />
          )}
          {spaceQuery.isFetching && !space && !!roomId && (
            <Text role="status" c="dimmed">
              Loading seats…
            </Text>
          )}
          {space && (
            <>
              <Title order={2} className="break-words">
                {space.name}
              </Title>
              {!space.is_open && (
                <Alert title="Study space closed">
                  Choose a different room to book together.
                </Alert>
              )}
              <NativeSelect
                label="Choose a seat for"
                value={activeId}
                disabled={action.busy}
                data={members.map((m) => ({
                  value: m.person.id,
                  label:
                    m.person.id === social.user?.id ? 'You' : m.person.name,
                }))}
                rightSection={
                  <Icon name="back" size="sm" className="-rotate-90" />
                }
                onChange={(e) => setActive(e.currentTarget.value)}
              />
              <div className="h-105 shrink-0">
                <SeatMap
                  key={
                    plan ? `${plan.room.width}x${plan.room.height}` : 'stand-in'
                  }
                  plan={plan}
                  seats={seats}
                  selected={assignments[activeId] ?? ''}
                  highlightedSeats={picked}
                  onSelect={choose}
                />
              </div>
              {!!hidden && (
                <Text c="dimmed">
                  Some seats are outside this room preview. You can select them
                  from the list below.
                </Text>
              )}
              <NativeSelect
                label="Seat for this member"
                value={assignments[activeId] ?? ''}
                disabled={action.busy}
                data={[
                  { value: '', label: 'Choose a free seat' },
                  ...space.seats
                    .filter((s) => freeIds.has(s.id))
                    .map((s) => ({
                      value: s.id,
                      label: `Seat ${s.label}`,
                      disabled: members.some(
                        (m) =>
                          m.person.id !== activeId &&
                          assignments[m.person.id] === s.id,
                      ),
                    })),
                ]}
                rightSection={
                  <Icon name="back" size="sm" className="-rotate-90" />
                }
                onChange={(e) => {
                  if (e.currentTarget.value) choose(e.currentTarget.value);
                }}
              />
              <SectionLabel>
                Seat assignments · {picked.length}/{members.length}
              </SectionLabel>
              {members.map((m) => {
                const seat = space.seats.find(
                  (s) => s.id === assignments[m.person.id],
                );
                return (
                  <Card
                    key={m.person.id}
                    component="article"
                    aria-label={`Seat assignment for ${m.person.name}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="grid min-w-0 gap-1">
                        <Text className="break-words">
                          {m.person.id === social.user?.id
                            ? 'You'
                            : m.person.name}
                        </Text>
                        <Text size="sm" c="dimmed">
                          {seat
                            ? `Seat ${seat.label}${freeIds.has(seat.id) ? '' : ' · no longer free'}`
                            : 'Choose a seat'}
                        </Text>
                      </div>
                      <Button
                        variant="quiet"
                        disabled={action.busy}
                        onClick={() => setActive(m.person.id)}
                        aria-label={`Change seat for ${m.person.name}`}
                      >
                        {activeId === m.person.id ? 'Choosing' : 'Change'}
                      </Button>
                    </div>
                  </Card>
                );
              })}
              <Text size="sm" c="dimmed">
                Everyone gets a seat together, or none are booked. Pending
                invitations aren’t included.
              </Text>
            </>
          )}
        </>
      )}
      <DecisionSheet
        opened={sheet}
        onClose={() => setSheet(false)}
        title={`Reserve ${members.length} seats together?`}
        safeLabel="Keep choosing"
        actionLabel={action.busy ? 'Reserving…' : 'Reserve seats'}
        onConfirm={async () => {
          if (
            !party ||
            !allowed ||
            !complete ||
            !rules ||
            !space?.is_open ||
            action.busy
          )
            return;
          const ok = await action.perform(
            () =>
              action.book.mutateAsync({
                path: { party_id: party.id },
                body: {
                  assignments: members.map((m) => ({
                    user_id: m.person.id,
                    seat_id: assignments[m.person.id],
                  })),
                },
              }),
            () => navigate(paths.reservation),
          );
          if (ok) setSheet(false);
        }}
      >
        {action.error ||
          `${space?.name ?? 'Your study space'}. Each person must check in within ${rules?.check_in_window_minutes ?? 'the allowed'} minutes. Pending invitations won’t be included.`}
      </DecisionSheet>
    </DraftFrame>
  );
}
