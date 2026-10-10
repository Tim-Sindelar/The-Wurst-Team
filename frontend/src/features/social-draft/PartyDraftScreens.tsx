import {
  Alert,
  Button,
  Card,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { DecisionSheet } from '../../components/DecisionSheet';
import { Icon } from '../../components/Icon';
import { SectionLabel } from '../../components/SectionLabel';
import { StatusBanner } from '../../components/StatusBanner';
import { draftPaths } from './draft';
import { PersonRow } from './FriendsDraftScreens';
import { DraftFrame } from './SocialDraftLayout';
import { useSocialDraft } from './useSocialDraft';

export function PartiesDraftScreen() {
  const { state } = useSocialDraft();
  const ready = state.party.members.filter(
    (m) => m.status === 'accepted',
  ).length;
  const invited = state.party.members.filter(
    (m) => m.status === 'invited',
  ).length;
  const member = state.party.members.find((m) => m.person.id === state.viewer);
  const visible =
    member?.status === 'accepted' ||
    (member?.status === 'invited' && state.party.status === 'open');
  return (
    <DraftFrame
      title="Study parties"
      backTo={draftPaths.friends}
      actions={
        <Button
          component={Link}
          to={draftPaths.newParty}
          leftSection={<Icon name="plus" />}
        >
          Create a party
        </Button>
      }
    >
      <Text c="dimmed">
        Find a room, choose seats, and book together. Everyone checks in at
        their own seat.
      </Text>
      <SectionLabel>Your parties</SectionLabel>
      {visible ? (
        <Card component={Link} to={draftPaths.party} className="no-underline">
          <div className="flex items-center justify-between gap-3">
            <div className="grid min-w-0 gap-2">
              <Title order={2} className="break-words">
                {state.party.name}
              </Title>
              <Text size="sm" c="dimmed">
                {state.party.status === 'open'
                  ? `${ready} ready · ${invited} invited`
                  : state.party.status === 'booked'
                    ? 'Seats reserved · HG E 41'
                    : 'Party cancelled'}
              </Text>
              <Text size="sm">
                {state.viewer === 'you'
                  ? 'You organize this party'
                  : member?.status === 'invited'
                    ? 'You’re invited'
                    : 'You joined this party'}
              </Text>
            </div>
            <Icon name="chevronRight" />
          </div>
        </Card>
      ) : (
        <Card>
          <Text c="dimmed">
            No parties yet. Create one and invite your friends.
          </Text>
        </Card>
      )}
    </DraftFrame>
  );
}

export function PartyEditorDraftScreen() {
  const { state, dispatch } = useSocialDraft();
  const navigate = useNavigate();
  const creating = useLocation().pathname === draftPaths.newParty;
  const [name, setName] = useState('Afternoon study');
  const [selected, setSelected] = useState<string[]>([]);
  const ready = state.party.members.filter((m) =>
    ['invited', 'accepted'].includes(m.status),
  );
  const canInvite =
    creating || (state.viewer === 'you' && state.party.status === 'open');
  return (
    <DraftFrame
      title={creating ? 'Create a party' : 'Invite friends'}
      backTo={creating ? draftPaths.parties : draftPaths.party}
      actions={
        <Button
          type="submit"
          form="party-editor-form"
          disabled={
            !canInvite || (creating ? !name.trim() : selected.length === 0)
          }
        >
          {creating ? 'Create party' : 'Send invitations'}
        </Button>
      }
    >
      {!canInvite && (
        <Alert variant="danger" role="alert" title="Invitations unavailable">
          Only the organizer can invite friends to an open party.
        </Alert>
      )}
      <Card
        component="form"
        id="party-editor-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canInvite || (creating && !name.trim())) return;
          dispatch(
            creating
              ? { type: 'create-party', name: name.trim(), invited: selected }
              : { type: 'invite-members', invited: selected },
          );
          navigate(draftPaths.party);
        }}
      >
        {creating && (
          <TextInput
            label="Party name"
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
        )}
        <Text size="sm" c="dimmed">
          Invite accepted friends. They’ll each choose whether to join before
          you can reserve a seat for them.
        </Text>
        <SectionLabel>Invite friends</SectionLabel>
        {state.friends.map((person) => {
          const existing =
            !creating && ready.some((m) => m.person.id === person.id);
          return (
            <div
              key={person.id}
              className="grid gap-1 border-b border-border pb-3 last:border-b-0 last:pb-0"
            >
              <Switch
                label={person.name}
                checked={existing || selected.includes(person.id)}
                disabled={!canInvite || existing}
                onChange={(e) => {
                  const checked = e.currentTarget.checked;
                  setSelected((ids) =>
                    checked
                      ? [...ids, person.id]
                      : ids.filter((id) => id !== person.id),
                  );
                }}
              />
              <Text size="sm" c="dimmed">
                {existing
                  ? 'Already in this party'
                  : (person.room ?? 'No shared location')}
              </Text>
            </div>
          );
        })}
        {state.friends.length === 0 && (
          <Text c="dimmed">Add friends before sending invitations.</Text>
        )}
      </Card>
    </DraftFrame>
  );
}

export function PartyDraftScreen() {
  const { state, dispatch } = useSocialDraft();
  const navigate = useNavigate();
  const [sheet, setSheet] = useState<
    'join' | 'decline' | 'leave' | 'cancel' | null
  >(null);
  const [notice, setNotice] = useState('');
  const { party, viewer } = state;
  const member = party.members.find((m) => m.person.id === viewer);
  const isOrganizer = viewer === 'you';
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
                <Button onClick={() => setSheet('join')}>Join party</Button>
                <Button variant="secondary" onClick={() => setSheet('decline')}>
                  Decline invitation
                </Button>
              </>
            ) : isOrganizer ? (
              <>
                <Button component={Link} to={draftPaths.seats}>
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
                <Button component={Link} to={draftPaths.reservation}>
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
      <Card component="section" aria-label="Party summary">
        <Title order={2} className="text-heading break-words">
          {party.name}
        </Title>
        <Text c="dimmed">
          {isOrganizer ? 'You’re the organizer' : 'Organized by Alex Müller'}
        </Text>
        <Text size="sm">
          {party.status === 'open'
            ? `${accepted.length} ready · ${pending.length} invited`
            : party.status === 'booked'
              ? 'Seats reserved in HG E 41'
              : 'Party cancelled'}
        </Text>
        {party.status === 'open' && isOrganizer && (
          <Button variant="secondary" component={Link} to={draftPaths.invite}>
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
            detail={
              m.person.id === 'you'
                ? 'Organizer'
                : m.status === 'accepted'
                  ? 'Joined the party'
                  : m.status === 'invited'
                    ? 'Invitation pending'
                    : m.status === 'declined'
                      ? 'Declined invitation'
                      : 'Left the party'
            }
          />
          <Text size="sm" className="flex items-center gap-2">
            <Icon
              name={
                m.checkedIn
                  ? 'check'
                  : m.seat && !m.cancelled
                    ? 'qr'
                    : m.status === 'accepted'
                      ? 'check'
                      : 'clock'
              }
              size="sm"
            />
            {m.checkedIn
              ? `Seat ${m.seat} · checked in`
              : m.cancelled && m.seat
                ? `Seat ${m.seat} · released`
                : m.seat
                  ? `Seat ${m.seat} · needs to check in`
                  : m.status === 'accepted'
                    ? 'Ready to book'
                    : m.status === 'invited'
                      ? 'Waiting for a reply'
                      : 'Not included in booking'}
          </Text>
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
          if (sheet === 'join') {
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
            setNotice('Party cancelled');
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
