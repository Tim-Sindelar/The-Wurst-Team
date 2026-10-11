import { Button, Card, Switch, Text, TextInput, Title } from '@mantine/core';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { DirectoryPerson, FriendResponse } from '../../api/generated';
import { DecisionSheet } from '../../components/DecisionSheet';
import { Icon } from '../../components/Icon';
import { notify } from '../../components/notify';
import {
  ActionBar,
  Screen,
  ScreenHeader,
  ScreenMain,
} from '../../components/Screen';
import { SectionLabel } from '../../components/SectionLabel';
import { paths } from '../../routes';
import { going, groupSummary, memberOf, type Group } from './groups';
import {
  friendSeatPath,
  groupPath,
  groupSeatsPath,
  socialPaths,
} from './paths';
import {
  ActionError,
  AvatarStack,
  PeopleList,
  PersonRow,
  SocialStatus,
} from './SocialParts';
import { friendWhere, studyingFriends, studyingMark } from './studying';
import {
  useFriends,
  useGroups,
  usePeopleSearch,
  useSocialActions,
} from './useSocial';

export function FriendsScreen() {
  const social = useFriends();
  const groups = useGroups();
  const actions = useSocialActions();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState<FriendResponse | null>(null);
  const searching = search.trim().length >= 2;

  const studying = studyingFriends(social.friends);
  const others = social.friends.filter((friend) => !friend.room);
  const byName = (a: FriendResponse, b: FriendResponse) =>
    a.person.name.localeCompare(b.person.name);
  const inviteTo =
    groups.active?.status === 'open' &&
    groups.active.organizer_id === groups.user?.id
      ? groups.active
      : null;
  const rowAction = (friend: FriendResponse) =>
    editing ? (
      <Button
        variant="danger"
        aria-label={`Remove ${friend.person.name}`}
        onClick={() => setRemoving(friend)}
      >
        Remove
      </Button>
    ) : (
      inviteTo && (
        <InviteAction group={inviteTo} friend={friend} actions={actions} />
      )
    );

  return (
    <Screen>
      <ScreenHeader
        title="Friends"
        backTo={paths.home}
        backLabel="Back to home"
      />
      <ScreenMain>
        <TextInput
          type="search"
          placeholder="Search friends or add people"
          aria-label="Search friends or add people"
          leftSection={<Icon name="search" />}
          maxLength={80}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
        <SocialStatus
          loading={social.loading}
          error={social.error}
          retry={social.retry}
        />
        <ActionError error={actions.error} />

        {searching ? (
          <SearchResults
            search={search}
            friends={social.friends}
            rowAction={rowAction}
          />
        ) : (
          !social.loading &&
          !social.error && (
            <>
              <GroupCard groups={groups} />

              <div className="-mb-2 flex min-h-11 items-center justify-between gap-2">
                <SectionLabel>Studying now</SectionLabel>
                {social.friends.length > 0 && (
                  <Button
                    variant="quiet"
                    aria-pressed={editing}
                    onClick={() => setEditing((on) => !on)}
                  >
                    {editing ? 'Done' : 'Edit'}
                  </Button>
                )}
              </div>
              <PeopleList label="Studying now">
                {social.user && (
                  <PersonRow
                    person={{
                      id: social.user.id,
                      name: social.user.name,
                      photo_url: social.user.photo_url,
                    }}
                    name="You"
                    detail={
                      social.shareRoom ? 'Sharing your room' : 'Room hidden'
                    }
                  >
                    <div className="flex-none">
                      <Switch
                        aria-label="Share my room with friends"
                        checked={social.shareRoom}
                        disabled={actions.busy}
                        onChange={(event) => {
                          const on = event.currentTarget.checked;
                          void actions.run(() =>
                            actions.privacy.mutateAsync({
                              body: { share_room: on },
                            }),
                          );
                        }}
                      />
                    </div>
                  </PersonRow>
                )}
                {studying.map((friend) => (
                  <PersonRow
                    key={friend.friendship_id}
                    person={friend.person}
                    detail={friendWhere(friend.room)}
                    pinned
                    studying={studyingMark(friend.room)}
                    to={editing ? undefined : friendSeatPath(friend.room)}
                  >
                    {rowAction(friend)}
                  </PersonRow>
                ))}
              </PeopleList>

              {others.length > 0 && (
                <>
                  <SectionLabel>Others</SectionLabel>
                  <PeopleList label="Others">
                    {others.sort(byName).map((friend) => (
                      <PersonRow
                        key={friend.friendship_id}
                        person={friend.person}
                      >
                        {rowAction(friend)}
                      </PersonRow>
                    ))}
                  </PeopleList>
                </>
              )}
              {social.friends.length === 0 && (
                <Text c="dimmed">Search above to add friends.</Text>
              )}
            </>
          )
        )}
      </ScreenMain>

      {!searching && (
        <ActionBar>
          <GroupAction groups={groups} />
        </ActionBar>
      )}

      <DecisionSheet
        opened={!!removing}
        onClose={() => {
          setRemoving(null);
          actions.clearError();
        }}
        title={`Remove ${removing?.person.name ?? ''}?`}
        safeLabel="Keep friend"
        actionLabel="Remove friend"
        actionTone="danger"
        onConfirm={async () => {
          if (!removing) return;
          const friend = removing;
          const ok = await actions.run(() =>
            actions.removeFriendship.mutateAsync({
              path: { friendship_id: friend.friendship_id },
            }),
          );
          if (ok) {
            setRemoving(null);
            notify('Friend removed');
          }
        }}
      >
        {actions.error || 'You’ll stop seeing each other’s rooms.'}
      </DecisionSheet>
    </Screen>
  );
}

/** While typing: matching friends, then people to add. */
function SearchResults({
  search,
  friends,
  rowAction,
}: {
  search: string;
  friends: FriendResponse[];
  rowAction: (friend: FriendResponse) => ReactNode;
}) {
  const { people, searching, error } = usePeopleSearch(search);
  const actions = useSocialActions();
  const query = search.trim().toLowerCase();
  const mine = friends.filter((friend) =>
    friend.person.name.toLowerCase().includes(query),
  );
  const others = people.filter((person) => person.relationship !== 'friends');

  const action = (person: DirectoryPerson) => {
    if (person.relationship === 'incoming')
      return (
        <Button
          variant="secondary"
          disabled={actions.busy}
          aria-label={`Accept ${person.name}`}
          onClick={async () => {
            if (
              await actions.run(() =>
                actions.acceptRequest.mutateAsync({
                  path: { friendship_id: person.friendship_id! },
                }),
              )
            )
              notify(`You’re now friends with ${person.name}`, 'userCheck');
          }}
        >
          Accept
        </Button>
      );
    if (person.relationship === 'outgoing')
      return (
        <Button
          variant="quiet"
          disabled={actions.busy}
          aria-label={`Cancel request to ${person.name}`}
          onClick={async () => {
            if (
              await actions.run(() =>
                actions.removeFriendship.mutateAsync({
                  path: { friendship_id: person.friendship_id! },
                }),
              )
            )
              notify('Request cancelled');
          }}
        >
          Requested
        </Button>
      );
    return (
      <Button
        variant="secondary"
        disabled={actions.busy}
        leftSection={<Icon name="plus" size="sm" />}
        aria-label={`Send friend request to ${person.name}`}
        onClick={async () => {
          if (
            await actions.run(() =>
              actions.sendRequest.mutateAsync({ body: { user_id: person.id } }),
            )
          )
            notify(`Friend request sent to ${person.name}`, 'userPlus');
        }}
      >
        Add
      </Button>
    );
  };

  return (
    <>
      <ActionError error={actions.error || error} />
      {mine.length > 0 && (
        <>
          <SectionLabel>Friends</SectionLabel>
          <PeopleList label="Friends">
            {mine.map((friend) => (
              <PersonRow
                key={friend.friendship_id}
                person={friend.person}
                detail={friend.room && friendWhere(friend.room)}
                pinned
                studying={studyingMark(friend.room)}
                to={friend.room ? friendSeatPath(friend.room) : undefined}
              >
                {rowAction(friend)}
              </PersonRow>
            ))}
          </PeopleList>
        </>
      )}
      {(searching || others.length > 0 || mine.length === 0) && (
        <SectionLabel>Add people</SectionLabel>
      )}
      {searching ? (
        <Text c="dimmed" role="status">
          Searching…
        </Text>
      ) : others.length > 0 ? (
        <PeopleList label="Add people">
          {others.map((person) => (
            <PersonRow key={person.id} person={person}>
              {action(person)}
            </PersonRow>
          ))}
        </PeopleList>
      ) : (
        mine.length === 0 && (
          <Text c="dimmed" role="status">
            No one found.
          </Text>
        )
      )}
    </>
  );
}

/** Invite a friend to the open group you organize; nothing once they're going. */
function InviteAction({
  group,
  friend,
  actions,
}: {
  group: Group;
  friend: FriendResponse;
  actions: ReturnType<typeof useSocialActions>;
}) {
  const { person } = friend;
  const status = memberOf(group, person.id)?.status;
  if (status === 'accepted') return null;
  if (status === 'invited')
    return (
      <Text size="sm" c="dimmed" className="flex-none">
        Invited
      </Text>
    );
  return (
    <Button
      variant="secondary"
      disabled={actions.busy}
      aria-label={`Invite ${person.name} to ${group.name}`}
      onClick={async () => {
        if (
          await actions.run(() =>
            actions.invite.mutateAsync({
              path: { party_id: group.id },
              body: { user_id: person.id },
            }),
          )
        )
          notify(`Invited ${person.name}`, 'mail');
      }}
    >
      Invite
    </Button>
  );
}

/** The group you're in: name, how many are going, and their faces. */
function GroupCard({ groups }: { groups: ReturnType<typeof useGroups> }) {
  const group = groups.active;
  if (!group) return null;
  const seat = memberOf(group, groups.user?.id)?.seat;
  return (
    <Card
      component={Link}
      to={groupPath(group.id)}
      className="no-underline"
      aria-label={`Open ${group.name}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <Title order={2} className="wrap-anywhere">
            {group.name}
          </Title>
          <Text size="sm" c="dimmed">
            {group.status === 'booked' && seat
              ? `${seat.room.name} · seat ${seat.label}`
              : groupSummary(group)}
          </Text>
        </div>
        <Icon name="chevronRight" />
      </div>
      <AvatarStack people={going(group).map((member) => member.person)} />
    </Card>
  );
}

/** The screen's one primary action: the next step for your group. */
function GroupAction({ groups }: { groups: ReturnType<typeof useGroups> }) {
  const group = groups.active;
  const unavailable = groups.loading || !!groups.error;
  if (!group)
    return (
      <Button
        component={Link}
        to={socialPaths.newGroup}
        fullWidth
        disabled={unavailable}
        leftSection={<Icon name="plus" />}
      >
        Start a study group
      </Button>
    );
  const { held, running } = groups.booking;
  if (group.status === 'booked')
    return (
      <Button
        component={Link}
        to={held ? paths.scan : running ? paths.session : groupPath(group.id)}
        fullWidth
        leftSection={held && <Icon name="qr" />}
      >
        {held
          ? `Check in at seat ${held.seat.label}`
          : running
            ? 'View session'
            : `Open ${group.name}`}
      </Button>
    );
  if (group.organizer_id !== groups.user?.id)
    return (
      <Button component={Link} to={groupPath(group.id)} fullWidth>
        Open {group.name}
      </Button>
    );
  const count = going(group).length;
  return count < 2 ? (
    <Button fullWidth disabled>
      Waiting for friends to join
    </Button>
  ) : (
    <Button component={Link} to={groupSeatsPath(group.id)} fullWidth>
      Choose seats for {count}
    </Button>
  );
}
