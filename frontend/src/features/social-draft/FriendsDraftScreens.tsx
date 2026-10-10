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
import { Link, useSearchParams } from 'react-router';
import { DecisionSheet } from '../../components/DecisionSheet';
import { Icon } from '../../components/Icon';
import { SectionLabel } from '../../components/SectionLabel';
import { StatusBanner } from '../../components/StatusBanner';
import { paths } from '../../routes';
import { draftPaths, initials, sampleInvite, type DraftPerson } from './draft';
import { DraftFrame } from './SocialDraftLayout';
import { useSocialDraft } from './useSocialDraft';

export function FriendsDraftScreen() {
  const { state, dispatch } = useSocialDraft();
  const [search, setSearch] = useState('');
  const [remove, setRemove] = useState<DraftPerson | null>(null);
  const [notice, setNotice] = useState('');
  const friends = state.friends.filter((p) =>
    p.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const ready = state.party.members.filter(
    (m) => m.status === 'accepted',
  ).length;

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
      <Card
        component={Link}
        to={draftPaths.parties}
        className="no-underline"
        aria-label="Open your study parties"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <Title order={2}>Study together</Title>
            <Text size="sm" c="dimmed">
              {state.party.name} · {ready} ready
            </Text>
          </div>
          <Icon name="chevronRight" />
        </div>
      </Card>

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
              <PersonRow
                person={person}
                detail={person.room ?? 'No shared location'}
                location={!!person.room}
              />
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

      <SectionLabel>Privacy</SectionLabel>
      <Card component="section" aria-label="Location sharing">
        <Switch
          label="Share my study room with friends"
          checked={state.shareRoom}
          onChange={(e) => {
            dispatch({ type: 'privacy', enabled: e.currentTarget.checked });
            setNotice(
              e.currentTarget.checked
                ? 'Room sharing enabled'
                : 'Room sharing disabled',
            );
          }}
        />
        <Text size="sm" c="dimmed">
          Only accepted friends can see your room while you’re checked in. Your
          exact seat and phone location stay private.
        </Text>
      </Card>

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
      <StatusBanner
        opened={!!notice}
        onClose={() => setNotice('')}
        icon="check"
        title={notice}
      />
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
  const ownLink = `${window.location.origin}${draftPaths.add}?invite=you`;
  const [invite, setInvite] = useState(() =>
    inviteCode === 'sam'
      ? `${window.location.origin}${draftPaths.add}?invite=sam`
      : inviteCode === 'you'
        ? ownLink
        : '',
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
        url.pathname !== draftPaths.add ||
        url.searchParams.get('invite') !== 'sam'
      ) {
        setError(
          'That invite link isn’t available in this preview. Use Sam’s sample link above.',
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
        {invite === `${window.location.origin}${draftPaths.add}?invite=sam` &&
          !error && (
            <PersonRow
              person={sampleInvite}
              detail="Send a request to connect"
            />
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
