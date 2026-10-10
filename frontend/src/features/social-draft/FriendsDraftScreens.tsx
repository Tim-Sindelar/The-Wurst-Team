import {
  ActionIcon,
  Alert,
  Avatar,
  Button,
  Card,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useState } from 'react';
import { Link, useHref, useSearchParams } from 'react-router';
import { DecisionSheet } from '../../components/DecisionSheet';
import { Icon } from '../../components/Icon';
import { SectionLabel } from '../../components/SectionLabel';
import { StatusBanner } from '../../components/StatusBanner';
import { paths } from '../../routes';
import {
  activeDraftParties,
  draftPaths,
  initials,
  sampleInvite,
  type DraftPerson,
} from './draft';
import { DraftFrame } from './SocialDraftLayout';
import { useSocialDraft } from './useSocialDraft';

export function FriendsDraftScreen() {
  const { state, dispatch } = useSocialDraft();
  const parties = activeDraftParties(state.parties);
  const requests = state.requests.filter((r) => r.incoming).length;
  return (
    <DraftFrame
      title="Friends"
      backTo={paths.home}
      actions={
        <Button
          component={Link}
          to={draftPaths.add}
          leftSection={<Icon name="plus" />}
        >
          Add a friend
        </Button>
      }
    >
      <SectionLabel>Privacy</SectionLabel>
      <Card component="section" aria-label="Location sharing">
        <Switch
          label="Share my study room with friends"
          checked={state.shareRoom}
          onChange={(e) => {
            dispatch({ type: 'privacy', enabled: e.currentTarget.checked });
          }}
        />
        <Text size="sm" c="dimmed">
          Friends can see your room only while you’re checked in. Your seat and
          phone location stay private.
        </Text>
      </Card>
      <SectionLabel>Study together</SectionLabel>
      <Card
        component={Link}
        to={draftPaths.parties}
        className="no-underline"
        aria-label="Open your study parties"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <Title order={2}>Study parties</Title>
            <Text size="sm" c="dimmed">
              {parties.length
                ? `${parties.length} active ${parties.length === 1 ? 'party' : 'parties'} · invitations and group bookings`
                : 'Create a party and book seats together'}
            </Text>
          </div>
          <Icon name="chevronRight" />
        </div>
      </Card>
      <Card component={Link} to={draftPaths.locations} className="no-underline">
        <div className="flex items-center gap-3">
          <Icon name="pin" />
          <div className="grid min-w-0 flex-1 gap-1">
            <Title order={2}>Stalk my friends</Title>
            <Text size="sm" c="dimmed">
              Find the rooms your friends choose to share
            </Text>
          </div>
          <Icon name="chevronRight" />
        </div>
      </Card>
      <SectionLabel>Friendships</SectionLabel>
      <Card component={Link} to={draftPaths.manage} className="no-underline">
        <div className="flex items-center gap-3">
          <Icon name="friends" />
          <div className="grid min-w-0 flex-1 gap-1">
            <Title order={2}>Manage friends</Title>
            <Text size="sm" c="dimmed">
              {state.friends.length} friends
              {requests
                ? ` · ${requests} ${requests === 1 ? 'request' : 'requests'} to review`
                : ''}
            </Text>
          </div>
          <Icon name="chevronRight" />
        </div>
      </Card>
    </DraftFrame>
  );
}

export function ManageFriendsDraftScreen() {
  const { state, dispatch } = useSocialDraft();
  const [search, setSearch] = useState('');
  const [remove, setRemove] = useState<DraftPerson | null>(null);
  const [notice, setNotice] = useState('');
  const friends = state.friends.filter((p) =>
    p.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <DraftFrame
      title="Manage friends"
      backTo={draftPaths.friends}
      actions={
        <Button
          component={Link}
          to={draftPaths.add}
          leftSection={<Icon name="plus" />}
        >
          Add a friend
        </Button>
      }
    >
      <StatusBanner
        opened={!!notice}
        onClose={() => setNotice('')}
        icon="check"
        title={notice}
      />
      {state.requests.length > 0 && (
        <SectionLabel>Friend requests · {state.requests.length}</SectionLabel>
      )}
      {state.requests.map(({ person, incoming }) => (
        <Card
          key={person.id}
          component="article"
          aria-label={`${person.name}, ${incoming ? 'incoming' : 'outgoing'} request`}
        >
          <PersonRow
            person={person}
            detail={
              incoming
                ? 'Wants to be your friend'
                : 'Request sent · waiting for a reply'
            }
          />
          <div className="flex flex-wrap gap-2">
            {incoming && (
              <Button
                variant="secondary"
                onClick={() => {
                  dispatch({ type: 'accept-request', id: person.id });
                  setNotice(`You’re now friends with ${person.name}`);
                }}
              >
                Accept request
              </Button>
            )}
            <Button
              variant="quiet"
              onClick={() => {
                dispatch({ type: 'remove-request', id: person.id });
                setNotice(incoming ? 'Request declined' : 'Request cancelled');
              }}
            >
              {incoming ? 'Decline' : 'Cancel request'}
            </Button>
          </div>
        </Card>
      ))}

      <SectionLabel>Your friends · {state.friends.length}</SectionLabel>
      <TextInput
        type="search"
        label="Find a friend"
        placeholder="Search by name"
        leftSection={<Icon name="search" />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      {friends.map((person) => (
        <Card key={person.id} component="article" aria-label={person.name}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <PersonRow person={person} detail="Friend" />
            </div>
            <ActionIcon
              aria-label={`Remove ${person.name} from friends`}
              onClick={() => setRemove(person)}
            >
              <Icon name="close" />
            </ActionIcon>
          </div>
        </Card>
      ))}
      {friends.length === 0 && (
        <Card>
          <Text c="dimmed">
            {search
              ? 'No friends match that name.'
              : 'Add a friend to start studying together.'}
          </Text>
        </Card>
      )}

      <DecisionSheet
        opened={!!remove}
        onClose={() => setRemove(null)}
        title={`Remove ${remove?.name ?? 'friend'}?`}
        safeLabel="Keep friend"
        actionLabel="Remove friend"
        actionTone="danger"
        onConfirm={() => {
          if (remove) dispatch({ type: 'remove-friend', id: remove.id });
          setRemove(null);
          setNotice('Friend removed');
        }}
      >
        You’ll stop sharing your study room with each other. You can send
        another request later.
      </DecisionSheet>
    </DraftFrame>
  );
}

export function FriendLocationsDraftScreen() {
  const { state } = useSocialDraft();
  const shared = state.friends.filter((p) => p.room !== null);
  return (
    <DraftFrame
      title="Stalk my friends"
      backTo={draftPaths.friends}
      actions={
        <Button
          component={Link}
          to={paths.map}
          leftSection={<Icon name="map" />}
        >
          Open campus map
        </Button>
      }
    >
      <Text c="dimmed">
        Only rooms your friends share while checked in. No seat numbers or live
        tracking.
      </Text>
      <SectionLabel>Shared study rooms · {shared.length}</SectionLabel>
      {shared.map((person) => (
        <Card
          key={person.id}
          component="article"
          aria-label={`${person.name} in ${person.room}`}
        >
          <PersonRow person={person} detail={person.room!} location />
        </Card>
      ))}
      {shared.length === 0 && (
        <Card>
          <Text c="dimmed">No friends are sharing a study room right now.</Text>
        </Card>
      )}
      <Text size="sm" c="dimmed">
        Friends without a shared room stay private. Manage your own sharing at
        the top of Friends.
      </Text>
    </DraftFrame>
  );
}

export function PersonRow({
  person,
  detail,
  location = false,
}: {
  person: DraftPerson;
  detail: string;
  location?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <Avatar className="shrink-0" aria-hidden="true">
        {initials(person.name)}
      </Avatar>
      <div className="grid min-w-0 flex-1 gap-1">
        <Text className="break-words">{person.name}</Text>
        <Text size="sm" c="dimmed" className="flex items-start gap-1">
          {location && <Icon name="pin" size="sm" />}
          <span className="min-w-0 break-words">{detail}</span>
        </Text>
      </div>
    </div>
  );
}

export function AddFriendDraftScreen() {
  const [params] = useSearchParams();
  return (
    <AddFriendPreview
      key={params.get('invite') ?? ''}
      inviteCode={params.get('invite')}
    />
  );
}

function AddFriendPreview({ inviteCode }: { inviteCode: string | null }) {
  const { state, dispatch } = useSocialDraft();
  const addPath = useHref(draftPaths.add);
  const ownLink = `${window.location.origin}${addPath}?invite=you`;
  const sampleLink = `${window.location.origin}${addPath}?invite=sam`;
  const [invite, setInvite] = useState(() =>
    inviteCode === 'sam' ? sampleLink : inviteCode === 'you' ? ownLink : '',
  );
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const sent = state.requests.some((r) => r.person.id === sampleInvite.id);

  const send = () => {
    try {
      const url = new URL(invite.trim());
      if (url.searchParams.get('invite') === 'you') {
        setError(
          'This is your own invite link. Ask your friend to share theirs.',
        );
        return;
      }
      if (
        url.origin !== window.location.origin ||
        url.pathname !== addPath ||
        url.searchParams.get('invite') !== 'sam'
      ) {
        setError(
          'That invite link isn’t available in this preview. Use Sam’s sample link below.',
        );
        return;
      }
      dispatch({ type: 'send-request', person: sampleInvite });
      setError('');
      setNotice('Friend request sent to Sam');
    } catch {
      setError('Paste the complete invite link your friend shared.');
    }
  };

  return (
    <DraftFrame
      title="Add a friend"
      backTo={draftPaths.friends}
      actions={
        <Button
          type="submit"
          form="friend-invite-form"
          disabled={!invite.trim() || sent}
        >
          {sent ? 'Request sent' : 'Send friend request'}
        </Button>
      }
    >
      <SectionLabel>Your invite link</SectionLabel>
      <Card component="section" aria-label="Share your friend link">
        <Title order={2}>Let friends find you</Title>
        <Text size="sm" c="dimmed">
          Share your link. You’ll get a request to accept before you become
          friends.
        </Text>
        <TextInput
          label="Your friend link"
          value={ownLink}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(ownLink);
              setNotice('Invite link copied');
            } catch {
              setError(
                'Could not copy the link. Select the field and copy it manually.',
              );
            }
          }}
        >
          Copy invite link
        </Button>
      </Card>
      <SectionLabel>Have a friend’s link?</SectionLabel>
      <Button
        variant="quiet"
        component={Link}
        to={`${draftPaths.add}?invite=sam`}
      >
        Try Sam’s sample invite
      </Button>
      <Card
        component="form"
        id="friend-invite-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!sent) send();
        }}
      >
        <TextInput
          label="Friend’s invite link"
          type="url"
          placeholder="Paste their invite link"
          value={invite}
          onChange={(e) => {
            setInvite(e.currentTarget.value);
            setError('');
          }}
        />
        {invite === sampleLink && !error && (
          <PersonRow person={sampleInvite} detail="Send a request to connect" />
        )}
        <Text size="sm" c="dimmed">
          Opening a link doesn’t add anyone automatically.
        </Text>
      </Card>
      {error && (
        <Alert variant="danger" role="alert" title="Unable to add friend">
          {error}
        </Alert>
      )}
      <StatusBanner
        opened={!!notice}
        onClose={() => setNotice('')}
        icon="check"
        title={notice}
      />
    </DraftFrame>
  );
}
