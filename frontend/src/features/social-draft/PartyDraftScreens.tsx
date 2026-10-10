import { Alert, Button, Card, Text, TextInput, Title } from '@mantine/core';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { DecisionSheet } from '../../components/DecisionSheet';
import { Icon } from '../../components/Icon';
import { SectionLabel } from '../../components/SectionLabel';
import { StatusBanner } from '../../components/StatusBanner';
import {
  activeDraftParties,
  draftPaths,
  partyPath,
  type DraftParty,
} from './draft';
import { PersonRow } from './FriendsDraftScreens';
import { DraftFrame } from './SocialDraftLayout';
import { useSocialDraft } from './useSocialDraft';

export function PartiesDraftScreen() {
  const { state, canCreateParty, activeParty } = useSocialDraft();
  const parties = activeDraftParties(state.parties, state.viewer);
  const invitations = parties.filter((p) =>
    p.members.some(
      (m) => m.person.id === state.viewer && m.status === 'invited',
    ),
  );
  const joined = parties.filter((p) =>
    p.members.some(
      (m) => m.person.id === state.viewer && m.status === 'accepted',
    ),
  );
  return (
    <DraftFrame
      title="Study parties"
      backTo={draftPaths.friends}
      actions={
        canCreateParty ? (
          <Button
            component={Link}
            to={draftPaths.newParty}
            leftSection={<Icon name="plus" />}
          >
            Create a party
          </Button>
        ) : (
          <Button component={Link} to={partyPath(activeParty!.id)}>
            View your party
          </Button>
        )
      }
    >
      <Text c="dimmed">
        Find a room, choose seats, and book together. Everyone checks in at
        their own seat.
      </Text>
      {invitations.length > 0 && (
        <SectionLabel>Invitations · {invitations.length}</SectionLabel>
      )}
      {invitations.map((party) => (
        <PartySummary key={party.id} party={party} viewer={state.viewer} />
      ))}
      <SectionLabel>Your active party</SectionLabel>
      {joined.map((party) => (
        <PartySummary key={party.id} party={party} viewer={state.viewer} />
      ))}
      {joined.length === 0 && (
        <Card>
          <Text c="dimmed">
            No active parties. Create one or join a friend’s invitation.
          </Text>
        </Card>
      )}
      {state.parties
        .filter(
          (p) =>
            p.status === 'cancelled' &&
            p.members.some(
              (m) =>
                m.person.id === state.viewer && m.checkedIn && !m.cancelled,
            ),
        )
        .map((party) => (
          <Card
            key={party.id}
            component={Link}
            to={partyPath(party.id, 'reservation')}
            className="no-underline"
          >
            <Title order={2}>Your ongoing session</Title>
            <Text size="sm" c="dimmed">
              Your checked-in seat is still yours. Open your session.
            </Text>
          </Card>
        ))}
    </DraftFrame>
  );
}

export function PartySummary({
  party,
  viewer = 'you',
}: {
  party: DraftParty;
  viewer?: string;
}) {
  const ready = party.members.filter((m) => m.status === 'accepted').length;
  const invited = party.members.filter((m) => m.status === 'invited').length;
  const invitation = party.members.some(
    (m) => m.person.id === viewer && m.status === 'invited',
  );
  return (
    <Card component={Link} to={partyPath(party.id)} className="no-underline">
      <div className="flex items-center justify-between gap-3">
        <div className="grid min-w-0 gap-2">
          <Title order={2} className="break-words">
            {party.name}
          </Title>
          <Text size="sm" c="dimmed">
            {party.status === 'open'
              ? `${ready} joined${invited ? ` · ${invited} invited` : ''}`
              : party.status === 'booked'
                ? 'Seats reserved · HG E 41'
                : 'Party cancelled'}
          </Text>
          <Text size="sm">
            {invitation
              ? 'You’re invited · open to join or decline'
              : viewer === party.organizerId
                ? 'You organize this party'
                : 'You joined this party'}
          </Text>
        </div>
        <Icon name="chevronRight" />
      </div>
    </Card>
  );
}

export function PartyEditorDraftScreen() {
  const { dispatch, canCreateParty, activeParty } = useSocialDraft();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const create = () => {
    if (!name.trim() || !canCreateParty) return;
    const id = crypto.randomUUID();
    dispatch({ type: 'create-party', id, name: name.trim() });
    navigate(partyPath(id, 'invite'));
  };
  return (
    <DraftFrame
      title="Create a party"
      backTo={draftPaths.parties}
      actions={
        <Button
          type="submit"
          form="create-party-form"
          disabled={!name.trim() || !canCreateParty}
        >
          Create party
        </Button>
      }
    >
      {!canCreateParty && activeParty && (
        <Alert variant="danger" title="You already have an active party">
          Leave or cancel it first.{' '}
          <Button
            variant="secondary"
            component={Link}
            to={partyPath(activeParty.id)}
          >
            View your party
          </Button>
        </Alert>
      )}
      <Text c="dimmed">
        Name your party, then invite friends. You’ll choose seats together after
        they join.
      </Text>
      <Card
        component="form"
        id="create-party-form"
        onSubmit={(e) => {
          e.preventDefault();
          create();
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

export function InviteFriendsDraftScreen() {
  const { state, dispatch } = useSocialDraft();
  const [search, setSearch] = useState('');
  const canInvite =
    state.viewer === state.party.organizerId && state.party.status === 'open';
  const friends = state.friends.filter((p) =>
    p.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <DraftFrame
      title="Invite friends"
      backTo={partyPath(state.party.id)}
      actions={
        <Button component={Link} to={partyPath(state.party.id)}>
          Done
        </Button>
      }
    >
      <Title order={2} className="break-words">
        {state.party.name}
      </Title>
      <Text c="dimmed">
        Tap Invite next to a friend. They must join before you can book a seat
        for them.
      </Text>
      {!canInvite && (
        <Alert title="Invitations unavailable">
          Only the organizer can invite friends to an open party.
        </Alert>
      )}
      {state.friends.length > 0 && (
        <TextInput
          type="search"
          label="Find a friend"
          placeholder="Search by name"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          leftSection={<Icon name="search" />}
        />
      )}
      <SectionLabel>Your friends</SectionLabel>
      {friends.map((person) => {
        const member = state.party.members.find(
          (m) => m.person.id === person.id,
        );
        const existing =
          member?.status === 'accepted' || member?.status === 'invited';
        return (
          <Card key={person.id} component="article" aria-label={person.name}>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <PersonRow
                  person={person}
                  detail={
                    member?.status === 'accepted'
                      ? 'Joined'
                      : member?.status === 'invited'
                        ? 'Invitation sent'
                        : (person.room ?? 'No shared location')
                  }
                />
              </div>
              <Button
                variant="secondary"
                disabled={!canInvite || existing}
                aria-label={`${existing ? (member?.status === 'accepted' ? 'Joined' : 'Invited') : 'Invite'} ${person.name}`}
                onClick={() =>
                  dispatch({ type: 'invite-members', invited: [person.id] })
                }
              >
                {existing
                  ? member?.status === 'accepted'
                    ? 'Joined'
                    : 'Invited'
                  : 'Invite'}
              </Button>
            </div>
          </Card>
        );
      })}
      {friends.length === 0 && (
        <Text c="dimmed">
          {search
            ? 'No friends match that name.'
            : 'Add a friend to invite them to your party.'}
        </Text>
      )}
      {state.friends.length === 0 && (
        <Button variant="secondary" component={Link} to={draftPaths.add}>
          Add a friend
        </Button>
      )}
    </DraftFrame>
  );
}

export function PartyDraftScreen() {
  const { state, dispatch, conflictingParty } = useSocialDraft();
  const navigate = useNavigate();
  const [sheet, setSheet] = useState<
    'join' | 'decline' | 'leave' | 'cancel' | null
  >(null);
  const [notice, setNotice] = useState('');
  const { party, viewer } = state;
  const member = party.members.find((m) => m.person.id === viewer);
  const isOrganizer = viewer === party.organizerId;
  const organizerName = party.members.find(
    (m) => m.person.id === party.organizerId,
  )?.person.name;
  const accepted = party.members.filter((m) => m.status === 'accepted');
  const pending = party.members.filter((m) => m.status === 'invited');
  const hasSeat = !!member?.seat && !member.cancelled;
  const canView =
    member?.status === 'accepted' ||
    (member?.status === 'invited' && party.status === 'open');

  if (!canView)
    return (
      <DraftFrame
        title="Study party"
        backTo={draftPaths.parties}
        actions={
          <Button component={Link} to={draftPaths.parties}>
            Back to parties
          </Button>
        }
      >
        <Alert title="This party isn’t available">
          You left or declined this party, or the organizer booked before you
          joined.
        </Alert>
      </DraftFrame>
    );

  return (
    <DraftFrame
      title="Study party"
      backTo={draftPaths.parties}
      actions={
        <>
          {party.status === 'open' ? (
            member.status === 'invited' ? (
              <>
                <Button
                  disabled={!!conflictingParty}
                  onClick={() => setSheet('join')}
                >
                  Join party
                </Button>
                <Button variant="secondary" onClick={() => setSheet('decline')}>
                  Decline invitation
                </Button>
              </>
            ) : isOrganizer ? (
              <>
                <Button component={Link} to={partyPath(party.id, 'seats')}>
                  Choose seats for {accepted.length}
                </Button>
                <Button variant="secondary" onClick={() => setSheet('cancel')}>
                  Cancel party
                </Button>
              </>
            ) : (
              <Button variant="secondary" onClick={() => setSheet('leave')}>
                Leave party
              </Button>
            )
          ) : (
            <>
              {hasSeat ? (
                <Button
                  component={Link}
                  to={partyPath(party.id, 'reservation')}
                >
                  View my seat
                </Button>
              ) : (
                <Button component={Link} to={draftPaths.newParty}>
                  Create another party
                </Button>
              )}
              {party.status === 'booked' && isOrganizer && (
                <Button variant="secondary" onClick={() => setSheet('cancel')}>
                  Cancel party booking
                </Button>
              )}
            </>
          )}
        </>
      }
    >
      {party.status === 'open' &&
        member.status === 'invited' &&
        conflictingParty && (
          <Alert variant="danger" title="You already have an active party">
            Leave or cancel {conflictingParty.name} before joining this one.{' '}
            <Button
              variant="secondary"
              component={Link}
              to={partyPath(conflictingParty.id)}
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
          {isOrganizer
            ? 'You’re the organizer'
            : `Organized by ${organizerName}`}
        </Text>
        <Text size="sm">
          {party.status === 'open'
            ? `${accepted.length} ready · ${pending.length} invited`
            : party.status === 'booked'
              ? 'Seats reserved in HG E 41'
              : 'Party cancelled'}
        </Text>
        {party.status === 'open' && isOrganizer && (
          <Button
            variant="secondary"
            component={Link}
            to={partyPath(party.id, 'invite')}
          >
            Invite friends
          </Button>
        )}
      </Card>
      {party.status === 'open' && member.status === 'invited' && (
        <Alert
          title="You’re invited to study together"
          icon={<Icon name="info" />}
        >
          Joining lets the organizer reserve a seat for you and cancel it before
          you check in. You’ll check in yourself.
        </Alert>
      )}
      {party.status === 'open' && isOrganizer && pending.length > 0 && (
        <Alert title="Waiting for replies">
          Only ready members will get a seat. Pending invitations close when you
          book.
        </Alert>
      )}
      {party.status === 'open' &&
        !isOrganizer &&
        member.status === 'accepted' && (
          <Alert title="You’re ready">
            The organizer will choose seats for everyone who joined. You can
            leave before the booking is made.
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
        <Card
          key={m.person.id}
          component="article"
          aria-label={`${m.person.name}, ${m.status}`}
        >
          <PersonRow
            person={{
              ...m.person,
              name: m.person.id === viewer ? 'You' : m.person.name,
            }}
            detail={[
              m.person.id === party.organizerId ? 'Organizer' : '',
              m.checkedIn
                ? `Seat ${m.seat} · checked in`
                : m.cancelled
                  ? m.seat
                    ? `Seat ${m.seat} · released`
                    : 'Party cancelled'
                  : m.seat
                    ? `Seat ${m.seat} · needs check-in`
                    : m.status === 'accepted'
                      ? 'Joined'
                      : m.status === 'invited'
                        ? 'Invitation pending'
                        : m.status === 'declined'
                          ? 'Declined'
                          : 'Left party',
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        </Card>
      ))}
      {party.status === 'booked' && (
        <Text size="sm" c="dimmed">
          Everyone must scan their own seat’s QR code within 15 minutes. One
          person missing check-in won’t cancel anyone else’s seat.
        </Text>
      )}

      <DecisionSheet
        opened={!!sheet}
        onClose={() => setSheet(null)}
        title={
          sheet === 'join'
            ? 'Join this study party?'
            : sheet === 'decline'
              ? 'Decline the invitation?'
              : sheet === 'leave'
                ? 'Leave this party?'
                : 'Cancel this party?'
        }
        safeLabel={
          sheet === 'join'
            ? 'Not now'
            : sheet === 'decline'
              ? 'Keep invitation'
              : sheet === 'leave'
                ? 'Stay in party'
                : 'Keep party'
        }
        actionLabel={
          sheet === 'join'
            ? 'Join party'
            : sheet === 'decline'
              ? 'Decline invitation'
              : sheet === 'leave'
                ? 'Leave party'
                : 'Cancel party'
        }
        actionTone={sheet === 'join' ? 'primary' : 'danger'}
        onConfirm={() => {
          if (sheet === 'join' && !conflictingParty) {
            dispatch({ type: 'reply', accept: true });
            setNotice('You joined the party');
          }
          if (sheet === 'decline') {
            dispatch({ type: 'reply', accept: false });
            navigate(draftPaths.parties);
          }
          if (sheet === 'leave') {
            dispatch({ type: 'leave' });
            navigate(draftPaths.parties);
          }
          if (sheet === 'cancel') {
            dispatch({ type: 'cancel-party' });
            navigate(draftPaths.parties);
          }
          setSheet(null);
        }}
      >
        {sheet === 'join'
          ? 'The organizer can reserve a seat for you and cancel it before check-in. You’ll check in yourself.'
          : sheet === 'decline' || sheet === 'leave'
            ? 'The organizer won’t reserve a seat for you.'
            : 'All unchecked-in party seats will be released. Checked-in sessions continue.'}
      </DecisionSheet>
      <StatusBanner
        opened={!!notice}
        onClose={() => setNotice('')}
        icon="check"
        title={notice}
      />
    </DraftFrame>
  );
}
