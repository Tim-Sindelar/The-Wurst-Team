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
import { Link, Navigate } from 'react-router';
import { DecisionSheet } from '../../components/DecisionSheet';
import { Icon } from '../../components/Icon';
import { SectionLabel } from '../../components/SectionLabel';
import { StatusBanner } from '../../components/StatusBanner';
import { paths } from '../../routes';
import {
  activeDraftParty,
  draftPaths,
  initials,
  type DraftPerson,
} from './draft';
import { DraftFrame } from './SocialDraftLayout';
import { useSocialDraft } from './useSocialDraft';
import { useFriends } from './useFriends';
import { friendsWithLocationsFirst } from './friends';
import { useNow } from '../../hooks/useNow';
import { socialDemoEnabled } from '../../features';
import { useParties } from './useParties';

export function FriendsDraftScreen() {
  const { state } = useSocialDraft();
  const social = useFriends();
  const now = useNow();
  const parties = useParties();
  const party = socialDemoEnabled
    ? activeDraftParty(state.parties, 'you', now)
    : parties.activeParty;
  const invitations = parties.parties.filter(
    (p) =>
      p.status === 'open' &&
      p.members.some(
        (m) => m.person.id === parties.user?.id && m.status === 'invited',
      ),
  ).length;
  const incoming = social.requests.filter((r) => r.incoming).length;
  const [search, setSearch] = useState('');
  const [remove, setRemove] = useState<DraftPerson | null>(null);
  const [notice, setNotice] = useState('');
  const friends = friendsWithLocationsFirst(social.friends, search);
  return (
    <DraftFrame
      title="Friends"
      backTo={paths.home}
      actions={
        <Button
          component={Link}
          to={draftPaths.add}
          fullWidth
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
          checked={social.shareRoom}
          disabled={social.busy || social.loading || !!social.error}
          onChange={(e) => void social.privacy(e.currentTarget.checked)}
        />
        <Text size="sm" c="dimmed">
          Friends can see your room only while you’re checked in. Your seat and
          phone location stay private.
        </Text>
      </Card>
      <FriendsDataNotice social={social} />
      <StatusBanner
        opened={!!notice}
        onClose={() => setNotice('')}
        icon="check"
        title={notice}
      />
      <SectionLabel>Study together</SectionLabel>
      <Card
        component={Link}
        to={draftPaths.parties}
        className="no-underline"
        aria-label="Open your study parties"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <Title order={2}>
              {socialDemoEnabled ? 'Study party · preview' : 'Study parties'}
            </Title>
            <Text size="sm" c="dimmed">
              {party ? party.name : 'Create a party or review invitations'}
              {!socialDemoEnabled &&
                invitations > 0 &&
                ` · ${invitations} ${invitations === 1 ? 'invitation' : 'invitations'}`}
            </Text>
          </div>
          <Icon name="chevronRight" />
        </div>
      </Card>
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Your friends · {social.friends.length}</SectionLabel>
        <Button variant="quiet" component={Link} to={draftPaths.manage}>
          Requests
          {incoming
            ? ` · ${incoming} new`
            : social.requests.length
              ? ` · ${social.requests.length}`
              : ''}
        </Button>
      </div>
      <TextInput
        type="search"
        label="Search your friends"
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
                detail={person.room ?? 'No shared room'}
                location={!!person.room}
              />
            </div>
            <ActionIcon
              aria-label={`Remove ${person.name} from friends`}
              disabled={social.busy || social.loading}
              onClick={() => setRemove(person)}
            >
              <Icon name="close" />
            </ActionIcon>
          </div>
        </Card>
      ))}
      {!social.loading && !social.error && !friends.length && (
        <Text c="dimmed">
          {search
            ? 'No friends match that name.'
            : 'Add a friend to start studying together.'}
        </Text>
      )}
      <DecisionSheet
        opened={!!remove}
        onClose={() => setRemove(null)}
        title={`Remove ${remove?.name ?? 'friend'}?`}
        safeLabel="Keep friend"
        actionLabel="Remove friend"
        actionTone="danger"
        onConfirm={async () => {
          if (!social.busy && remove && (await social.remove(remove))) {
            setRemove(null);
            setNotice('Friend removed');
          }
        }}
      >
        {social.error ||
          'You’ll stop sharing your study room with each other. You can send another request later.'}
      </DecisionSheet>
    </DraftFrame>
  );
}

export function ManageFriendsDraftScreen() {
  const social = useFriends();
  const [notice, setNotice] = useState('');
  return (
    <DraftFrame title="Friend requests" backTo={draftPaths.friends}>
      <FriendsDataNotice social={social} />
      <StatusBanner
        opened={!!notice}
        onClose={() => setNotice('')}
        icon="check"
        title={notice}
      />
      <SectionLabel>Friend requests · {social.requests.length}</SectionLabel>
      {social.requests.map(({ person, incoming }) => (
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
                disabled={social.busy || social.loading}
                onClick={async () => {
                  if (await social.accept(person))
                    setNotice(`You’re now friends with ${person.name}`);
                }}
              >
                Accept request
              </Button>
            )}
            <Button
              variant="quiet"
              disabled={social.busy || social.loading}
              onClick={async () => {
                if (await social.remove(person, true))
                  setNotice(
                    incoming ? 'Request declined' : 'Request cancelled',
                  );
              }}
            >
              {incoming ? 'Decline' : 'Cancel request'}
            </Button>
          </div>
        </Card>
      ))}
      {!social.loading && !social.error && !social.requests.length && (
        <Text c="dimmed">No pending friend requests.</Text>
      )}
    </DraftFrame>
  );
}

/** Preserve bookmarks for the previous separate location page. */
export function FriendLocationsDraftScreen() {
  return <Navigate replace to={draftPaths.friends} />;
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
      <Avatar src={person.photoUrl} className="shrink-0" aria-hidden="true">
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
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const social = useFriends(search);
  const chosen = social.people.find(
    (p) => p.id === selected && p.relationship === 'none',
  );
  return (
    <DraftFrame
      title="Add a friend"
      backTo={draftPaths.friends}
      actions={
        <Button
          disabled={
            !chosen || social.busy || social.loading || social.searching
          }
          onClick={async () => {
            if (chosen && (await social.send(chosen))) {
              setSelected(null);
              setNotice(`Friend request sent to ${chosen.name}`);
            }
          }}
        >
          Send friend request
        </Button>
      }
    >
      <FriendsDataNotice social={social} />
      <Text c="dimmed">
        Find people who have signed into the app. They’ll need to accept your
        request.
      </Text>
      <TextInput
        type="search"
        label="Find people"
        placeholder="Search by display name"
        maxLength={80}
        leftSection={<Icon name="search" />}
        value={search}
        onChange={(e) => {
          setSearch(e.currentTarget.value);
          setSelected(null);
        }}
      />
      <Text size="sm" c="dimmed">
        Signing in makes your display name and avatar discoverable. Your room
        stays private unless you share it.
      </Text>
      {search.trim().length < 2 ? (
        <Text c="dimmed">Enter at least two characters.</Text>
      ) : social.searching ? (
        <Text role="status" c="dimmed">
          Searching people…
        </Text>
      ) : (
        social.people.map((p) => (
          <Card key={p.id} component="article" aria-label={p.name}>
            <PersonRow
              person={{
                id: p.id,
                name: p.name,
                room: null,
                photoUrl: p.photo_url,
              }}
              detail={
                p.relationship === 'friends'
                  ? 'Friends'
                  : p.relationship === 'outgoing'
                    ? 'Request sent'
                    : p.relationship === 'incoming'
                      ? 'Wants to be your friend'
                      : 'App member'
              }
            />
            {p.relationship === 'none' && (
              <Button
                variant="secondary"
                disabled={social.busy}
                aria-pressed={selected === p.id}
                onClick={() => setSelected(p.id)}
              >
                {selected === p.id ? 'Selected' : 'Add friend'}
              </Button>
            )}
            {p.relationship === 'incoming' && (
              <Button
                variant="secondary"
                component={Link}
                to={draftPaths.manage}
              >
                Review request
              </Button>
            )}
          </Card>
        ))
      )}
      {search.trim().length >= 2 &&
        !social.searching &&
        !social.loading &&
        !social.error &&
        social.people.length === 0 && (
          <Text c="dimmed">No people match that name.</Text>
        )}
      {social.people.length === 20 && (
        <Text size="sm" c="dimmed">
          Showing the first 20 matches. Refine your search to find someone.
        </Text>
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

function FriendsDataNotice({
  social,
}: {
  social: ReturnType<typeof useFriends>;
}) {
  return (
    <>
      {social.loading && !social.error && (
        <Text role="status" c="dimmed">
          Loading friends…
        </Text>
      )}
      {social.error && (
        <Alert
          variant="danger"
          role="alert"
          title="Unable to load or update friends"
        >
          {social.error}
          <Button
            variant="secondary"
            className="mt-3"
            onClick={() => void social.retry()}
          >
            Try again
          </Button>
        </Alert>
      )}
    </>
  );
}
