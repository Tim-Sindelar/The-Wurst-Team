import { Alert, Button, Card, Text, TextInput, Title } from '@mantine/core';
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import type { PartyResponse } from '../../api/generated';
import { DecisionSheet } from '../../components/DecisionSheet';
import { Icon } from '../../components/Icon';
import { SectionLabel } from '../../components/SectionLabel';
import { StatusBanner } from '../../components/StatusBanner';
import { paths } from '../../routes';
import { draftPaths, partyPath } from './draft';
import { PersonRow } from './FriendsDraftScreens';
import { DraftFrame } from './SocialDraftLayout';
import { useFriends } from './useFriends';
import { useParties, usePartyActions } from './useParties';

export function LivePartyNotice({
  social,
  error = '',
}: {
  social: ReturnType<typeof useParties>;
  error?: string;
}) {
  if (social.error || error)
    return (
      <Alert
        variant="danger"
        role="alert"
        title="Unable to update study parties"
      >
        {error || social.error}
        {social.error && (
          <Button variant="secondary" className="mt-3" onClick={social.retry}>
            Try again
          </Button>
        )}
      </Alert>
    );
  return social.loading ? (
    <Text role="status" c="dimmed">
      Loading parties…
    </Text>
  ) : null;
}

function LivePartySummary({
  party,
  userId,
}: {
  party: PartyResponse;
  userId?: string;
}) {
  const joined = party.members.filter((m) => m.status === 'accepted').length;
  const invited = party.members.filter((m) => m.status === 'invited').length;
  const member = party.members.find((m) => m.person.id === userId);
  return (
    <Card component={Link} to={partyPath(party.id)} className="no-underline">
      <div className="flex items-center justify-between gap-3">
        <div className="grid min-w-0 gap-2">
          <Title order={2} className="break-words">
            {party.name}
          </Title>
          <Text size="sm" c="dimmed">
            {party.status === 'booked'
              ? `Seats booked · ${member?.seat?.room.name ?? 'Study together'}`
              : `${joined} joined${invited ? ` · ${invited} invited` : ''}`}
          </Text>
          <Text size="sm">
            {member?.status === 'invited'
              ? 'You’re invited · open to join or decline'
              : party.organizer_id === userId
                ? 'You organize this party'
                : 'You joined this party'}
          </Text>
        </div>
        <Icon name="chevronRight" />
      </div>
    </Card>
  );
}

export function LivePartiesScreen() {
  const social = useParties();
  const invitations = social.parties.filter(
    (p) =>
      p.status === 'open' &&
      p.members.some(
        (m) => m.person.id === social.user?.id && m.status === 'invited',
      ),
  );
  const ongoing = social.parties.find(
    (p) =>
      p.status === 'cancelled' &&
      p.members.some(
        (m) =>
          m.person.id === social.user?.id &&
          m.reservation_id === social.booking.running?.id,
      ),
  );
  return (
    <DraftFrame
      title="Study parties"
      backTo={draftPaths.friends}
      actions={
        <Button
          component={Link}
          disabled={social.loading || !!social.error}
          to={
            social.activeParty
              ? partyPath(social.activeParty.id)
              : draftPaths.newParty
          }
        >
          {social.activeParty ? 'View your party' : 'Create a party'}
        </Button>
      }
    >
      <Text c="dimmed">
        Find a room, choose seats, and book together. Everyone checks in at
        their own seat.
      </Text>
      <LivePartyNotice social={social} />
      {!!invitations.length && (
        <SectionLabel>Invitations · {invitations.length}</SectionLabel>
      )}
      {invitations.map((p) => (
        <LivePartySummary key={p.id} party={p} userId={social.user?.id} />
      ))}
      <SectionLabel>Your active party</SectionLabel>
      {social.activeParty ? (
        <LivePartySummary party={social.activeParty} userId={social.user?.id} />
      ) : (
        !social.loading &&
        !social.error && (
          <Card>
            <Text c="dimmed">
              No active parties. Create one or join a friend’s invitation.
            </Text>
          </Card>
        )
      )}
      {ongoing && (
        <Card component={Link} to={paths.session} className="no-underline">
          <Title order={2}>Your ongoing session</Title>
          <Text c="dimmed">
            The party was cancelled, but your checked-in seat is still yours.
          </Text>
        </Card>
      )}
    </DraftFrame>
  );
}

export function LivePartyEditorScreen() {
  const social = useParties();
  const action = usePartyActions();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const allowed =
    !!name.trim() &&
    !social.activeParty &&
    !social.loading &&
    !social.error &&
    !action.busy;
  return (
    <DraftFrame
      title="Create a party"
      backTo={draftPaths.parties}
      actions={
        <Button
          type="submit"
          form="live-create-party"
          disabled={!allowed}
          loading={action.busy}
        >
          Create party
        </Button>
      }
    >
      <LivePartyNotice social={social} error={action.error} />
      {social.activeParty && (
        <Alert variant="danger" title="You already have an active party">
          Leave or cancel it first.{' '}
          <Button
            variant="secondary"
            component={Link}
            to={partyPath(social.activeParty.id)}
          >
            View your party
          </Button>
        </Alert>
      )}
      <Text c="dimmed">
        Name your party, then invite friends. You’ll choose seats after they
        join.
      </Text>
      <Card
        component="form"
        id="live-create-party"
        onSubmit={(e) => {
          e.preventDefault();
          if (allowed)
            void action.perform(
              () => action.create.mutateAsync({ body: { name: name.trim() } }),
              (party) => navigate(partyPath(party.id, 'invite')),
            );
        }}
      >
        <TextInput
          label="Party name"
          required
          maxLength={80}
          value={name}
          placeholder="e.g. Afternoon study"
          onChange={(e) => setName(e.currentTarget.value)}
        />
      </Card>
    </DraftFrame>
  );
}

export function LiveInviteFriendsScreen() {
  const social = useParties();
  const action = usePartyActions();
  const friends = useFriends();
  const [search, setSearch] = useState('');
  const party = social.party;
  const allowed =
    party?.organizer_id === social.user?.id && party?.status === 'open';
  const visible = friends.friends.filter((p) =>
    p.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <DraftFrame
      title="Invite friends"
      backTo={party ? partyPath(party.id) : draftPaths.parties}
      actions={
        <Button
          component={Link}
          to={party ? partyPath(party.id) : draftPaths.parties}
        >
          Done
        </Button>
      }
    >
      <LivePartyNotice social={social} error={action.error || friends.error} />
      {party && (
        <Title order={2} className="break-words">
          {party.name}
        </Title>
      )}
      <Text c="dimmed">
        Tap Invite next to a friend. They must join before you can book a seat
        for them.
      </Text>
      {party && !allowed && (
        <Alert title="Invitations unavailable">
          Only the organizer can invite friends to an open party.
        </Alert>
      )}
      <TextInput
        type="search"
        label="Find a friend"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        leftSection={<Icon name="search" />}
      />
      <SectionLabel>Your friends</SectionLabel>
      {visible.map((p) => {
        const member = party?.members.find((m) => m.person.id === p.id);
        const existing =
          member?.status === 'accepted' || member?.status === 'invited';
        return (
          <Card key={p.id} component="article" aria-label={p.name}>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <PersonRow
                  person={p}
                  detail={
                    member?.status === 'accepted'
                      ? 'Joined'
                      : member?.status === 'invited'
                        ? 'Invitation sent'
                        : (p.room ?? 'No shared room')
                  }
                />
              </div>
              <Button
                variant="secondary"
                disabled={
                  !allowed || existing || action.busy || !!friends.error
                }
                aria-label={`Invite ${p.name}`}
                onClick={() => {
                  if (party && allowed)
                    void action.perform(() =>
                      action.invite.mutateAsync({
                        path: { party_id: party.id },
                        body: { user_id: p.id },
                      }),
                    );
                }}
              >
                {member?.status === 'accepted'
                  ? 'Joined'
                  : existing
                    ? 'Invited'
                    : 'Invite'}
              </Button>
            </div>
          </Card>
        );
      })}
      {!visible.length && !friends.loading && !friends.error && (
        <Text c="dimmed">
          {search
            ? 'No friends match that name.'
            : 'Add a friend to invite them to your party.'}
        </Text>
      )}
      {!friends.friends.length && (
        <Button variant="secondary" component={Link} to={draftPaths.add}>
          Add a friend
        </Button>
      )}
    </DraftFrame>
  );
}

export function LivePartyScreen() {
  const social = useParties();
  const action = usePartyActions();
  const navigate = useNavigate();
  const [sheet, setSheet] = useState<
    'join' | 'decline' | 'leave' | 'cancel' | null
  >(null);
  const [notice, setNotice] = useState('');
  const party = social.party;
  const member = party?.members.find((m) => m.person.id === social.user?.id);
  const organizer = party?.organizer_id === social.user?.id;
  const accepted = party?.members.filter((m) => m.status === 'accepted') ?? [];
  const pending = party?.members.filter((m) => m.status === 'invited') ?? [];
  const conflict =
    social.activeParty && social.activeParty.id !== party?.id
      ? social.activeParty
      : null;
  const hasSeat =
    !!social.booking.reservation &&
    !!(social.booking.held || social.booking.running) &&
    member?.reservation_id === social.booking.reservation.id;
  return (
    <DraftFrame
      title="Study party"
      backTo={draftPaths.parties}
      actions={
        party && member ? (
          <>
            {party.status === 'open' ? (
              member.status === 'invited' ? (
                <>
                  <Button
                    disabled={!!conflict || action.busy}
                    onClick={() => setSheet('join')}
                  >
                    Join party
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={action.busy}
                    onClick={() => setSheet('decline')}
                  >
                    Decline invitation
                  </Button>
                </>
              ) : organizer ? (
                <>
                  <Button component={Link} to={partyPath(party.id, 'seats')}>
                    Choose seats for {accepted.length}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={action.busy}
                    onClick={() => setSheet('cancel')}
                  >
                    Cancel party
                  </Button>
                </>
              ) : (
                <Button
                  variant="secondary"
                  disabled={action.busy}
                  onClick={() => setSheet('leave')}
                >
                  Leave party
                </Button>
              )
            ) : (
              <>
                {hasSeat && (
                  <Button
                    component={Link}
                    to={
                      social.booking.running ? paths.session : paths.reservation
                    }
                  >
                    View my seat
                  </Button>
                )}
                {party.status === 'booked' && organizer && (
                  <Button
                    variant="secondary"
                    disabled={action.busy}
                    onClick={() => setSheet('cancel')}
                  >
                    Cancel party booking
                  </Button>
                )}
              </>
            )}
          </>
        ) : undefined
      }
    >
      <LivePartyNotice social={social} error={action.error} />
      <StatusBanner
        opened={!!notice}
        onClose={() => setNotice('')}
        icon="check"
        title={notice}
      />
      {party && (
        <>
          {member?.status === 'invited' && conflict && (
            <Alert variant="danger" title="You already have an active party">
              Leave or cancel {conflict.name} before joining this one.{' '}
              <Button
                variant="secondary"
                component={Link}
                to={partyPath(conflict.id)}
              >
                View your party
              </Button>
            </Alert>
          )}
          <Card component="section" aria-label="Party summary">
            <Title order={2} className="text-heading break-words">
              {party.name}
            </Title>
            <Text c="dimmed">
              {organizer
                ? 'You’re the organizer'
                : `Organized by ${party.members.find((m) => m.person.id === party.organizer_id)?.person.name ?? 'your friend'}`}
            </Text>
            <Text size="sm">
              {party.status === 'open'
                ? `${accepted.length} joined · ${pending.length} invited`
                : party.status === 'booked'
                  ? `Seats reserved · ${member?.seat?.room.name ?? 'Study together'}`
                  : 'Party cancelled'}
            </Text>
            {party.status === 'open' && organizer && (
              <Button
                variant="secondary"
                component={Link}
                to={partyPath(party.id, 'invite')}
              >
                Invite friends
              </Button>
            )}
          </Card>
          {member?.status === 'invited' && (
            <Alert title="You’re invited to study together">
              Joining lets the organizer reserve a seat for you and cancel it
              before you check in. You’ll check in yourself.
            </Alert>
          )}
          {party.status === 'open' && organizer && !!pending.length && (
            <Alert title="Waiting for replies">
              Only joined members will get a seat. Pending invitations close
              when you book.
            </Alert>
          )}
          {party.status === 'cancelled' && (
            <Alert title="Party cancelled">
              Unchecked-in seats have been released. Members who checked in keep
              their sessions.
            </Alert>
          )}
          <SectionLabel>Members · {party.members.length}</SectionLabel>
          {party.members.map((m) => (
            <Card key={m.person.id} component="article">
              <PersonRow
                person={{
                  ...m.person,
                  room: null,
                  photoUrl: m.person.photo_url,
                }}
                detail={
                  m.seat
                    ? `Seat ${m.seat.label} · ${m.seat.room.name}`
                    : m.status === 'accepted'
                      ? 'Joined'
                      : m.status === 'invited'
                        ? 'Invited'
                        : m.status === 'declined'
                          ? 'Declined'
                          : 'Left'
                }
              />
            </Card>
          ))}
        </>
      )}
      <DecisionSheet
        opened={!!sheet}
        onClose={() => setSheet(null)}
        title={
          sheet === 'join'
            ? 'Join this party?'
            : sheet === 'decline'
              ? 'Decline this invitation?'
              : sheet === 'leave'
                ? 'Leave this party?'
                : 'Cancel this party?'
        }
        safeLabel="Keep as is"
        actionLabel={
          action.busy
            ? 'Saving…'
            : sheet === 'join'
              ? 'Join party'
              : sheet === 'decline'
                ? 'Decline invitation'
                : sheet === 'leave'
                  ? 'Leave party'
                  : 'Cancel party'
        }
        actionTone={sheet === 'join' ? 'primary' : 'danger'}
        onConfirm={async () => {
          if (!party || !sheet || action.busy) return;
          const choice = sheet;
          const path = { party_id: party.id };
          const ok = await action.perform(async () => {
            if (choice === 'join' || choice === 'decline')
              await action.reply.mutateAsync({
                path,
                body: { accept: choice === 'join' },
              });
            else if (choice === 'leave')
              await action.leave.mutateAsync({ path });
            else await action.cancel.mutateAsync({ path });
          });
          if (ok) {
            setSheet(null);
            if (choice === 'join') setNotice('You joined the party');
            else navigate(draftPaths.parties);
          }
        }}
      >
        {action.error ||
          (sheet === 'join'
            ? 'The organizer may reserve and cancel your seat until you check in. Each member checks in individually.'
            : sheet === 'cancel'
              ? 'Unstarted reservations are released. Checked-in sessions stay active.'
              : 'You won’t be included in this party’s booking.')}
      </DecisionSheet>
    </DraftFrame>
  );
}

/** Existing reservation/session/QR screens already enforce individual ownership. */
export function LivePartyReservationScreen() {
  const social = useParties();
  const member = social.party?.members.find(
    (m) => m.person.id === social.user?.id,
  );
  if (
    !social.loading &&
    !social.error &&
    social.booking.reservation &&
    member?.reservation_id === social.booking.reservation.id &&
    (social.booking.held || social.booking.running)
  )
    return (
      <Navigate
        replace
        to={social.booking.running ? paths.session : paths.reservation}
      />
    );
  return (
    <DraftFrame
      title="Your party seat"
      backTo={social.party ? partyPath(social.party.id) : draftPaths.parties}
    >
      <LivePartyNotice social={social} />
      {!social.loading && !social.error && (
        <Alert title="No active seat reserved for you">
          Your seat may have been cancelled or expired. Other members keep their
          own reservations.
        </Alert>
      )}
    </DraftFrame>
  );
}

export function LivePartyScanScreen() {
  const social = useParties();
  const member = social.party?.members.find(
    (m) => m.person.id === social.user?.id,
  );
  if (
    !social.loading &&
    !social.error &&
    social.booking.held &&
    member?.reservation_id === social.booking.held.id
  )
    return <Navigate replace to={paths.scan} />;
  return <LivePartyReservationScreen />;
}
