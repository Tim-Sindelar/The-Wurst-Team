import { Alert, Anchor, Button, Card, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { FriendRequestResponse } from '../../api/generated';
import { DecisionSheet } from '../../components/DecisionSheet';
import { Icon } from '../../components/Icon';
import { Screen, ScreenHeader, ScreenMain } from '../../components/Screen';
import { SectionLabel } from '../../components/SectionLabel';
import { going, type Group } from './groups';
import { groupPath, socialPaths } from './paths';
import {
  ActionError,
  AvatarStack,
  PeopleList,
  PersonRow,
  SocialStatus,
} from './SocialParts';
import { useFriends, useGroups, useSocialActions } from './useSocial';

/** Everything waiting for an answer, opened from the header bell: study party
    invitations, friend requests, and the requests you sent. */
export function RequestsScreen() {
  const social = useFriends();
  const groups = useGroups();
  const actions = useSocialActions();
  const navigate = useNavigate();
  const [sheet, setSheet] = useState<{
    group: Group;
    choice: 'join' | 'decline';
  } | null>(null);

  const answer = async (request: FriendRequestResponse, accept: boolean) => {
    const path = { friendship_id: request.id };
    await actions.run(() =>
      accept
        ? actions.acceptRequest.mutateAsync({ path })
        : actions.removeFriendship.mutateAsync({ path }),
    );
  };
  const cancel = async (request: FriendRequestResponse) => {
    await actions.run(() =>
      actions.removeFriendship.mutateAsync({
        path: { friendship_id: request.id },
      }),
    );
  };

  const loading = social.loading || groups.loading;
  const error = social.error || groups.error;
  const empty =
    !groups.invitations.length &&
    !social.incoming.length &&
    !social.outgoing.length;

  return (
    <Screen>
      <ScreenHeader
        title="Requests"
        backTo={socialPaths.friends}
        backLabel="Back to friends"
      />
      <ScreenMain>
        <SocialStatus
          loading={loading}
          error={error}
          retry={() => {
            social.retry();
            groups.retry();
          }}
        />
        {!sheet && <ActionError error={actions.error} />}

        {!loading && !error && empty && (
          <div className="grid justify-items-center gap-2 py-8 text-center text-text-muted">
            <Icon name="check" size="lg" />
            <Title order={2} className="text-text">
              All caught up
            </Title>
          </div>
        )}

        {groups.invitations.map((group) => {
          const organizer = group.members.find(
            (member) => member.person.id === group.organizer_id,
          );
          const conflict = groups.active;
          return (
            <Card
              key={group.id}
              component="article"
              aria-label={`${group.name}, invitation`}
            >
              <div className="grid gap-1">
                <Text size="sm" c="dimmed">
                  {organizer?.person.name ?? 'A friend'} invited you
                </Text>
                <Title order={2} className="wrap-anywhere">
                  {group.name}
                </Title>
              </div>
              <AvatarStack
                people={going(group).map((member) => member.person)}
              />
              {conflict && (
                <Alert variant="danger" icon={<Icon name="alert" />}>
                  <Text size="sm">
                    You’re already in{' '}
                    <Anchor component={Link} to={groupPath(conflict.id)}>
                      {conflict.name}
                    </Anchor>
                  </Text>
                </Alert>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="quiet"
                  disabled={actions.busy}
                  onClick={() => setSheet({ group, choice: 'decline' })}
                >
                  Decline
                </Button>
                <Button
                  variant="secondary"
                  disabled={actions.busy || !!conflict}
                  onClick={() => setSheet({ group, choice: 'join' })}
                >
                  Join
                </Button>
              </div>
            </Card>
          );
        })}

        {social.incoming.length > 0 && (
          <>
            <SectionLabel>Friend requests</SectionLabel>
            <PeopleList label="Friend requests">
              {social.incoming.map((request) => (
                <PersonRow key={request.id} person={request.person}>
                  <Button
                    variant="quiet"
                    disabled={actions.busy}
                    aria-label={`Decline ${request.person.name}`}
                    onClick={() => void answer(request, false)}
                  >
                    Decline
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={actions.busy}
                    aria-label={`Accept ${request.person.name}`}
                    onClick={() => void answer(request, true)}
                  >
                    Accept
                  </Button>
                </PersonRow>
              ))}
            </PeopleList>
          </>
        )}

        {social.outgoing.length > 0 && (
          <>
            <SectionLabel>Sent</SectionLabel>
            <PeopleList label="Sent">
              {social.outgoing.map((request) => (
                <PersonRow key={request.id} person={request.person}>
                  <Button
                    variant="quiet"
                    disabled={actions.busy}
                    aria-label={`Cancel request to ${request.person.name}`}
                    onClick={() => void cancel(request)}
                  >
                    Cancel
                  </Button>
                </PersonRow>
              ))}
            </PeopleList>
          </>
        )}
      </ScreenMain>

      <DecisionSheet
        opened={!!sheet}
        onClose={() => {
          setSheet(null);
          actions.clearError();
        }}
        title={
          sheet?.choice === 'join'
            ? `Join ${sheet.group.name}?`
            : `Decline ${sheet?.group.name ?? ''}?`
        }
        safeLabel="Not now"
        actionLabel={sheet?.choice === 'join' ? 'Join party' : 'Decline'}
        actionTone={sheet?.choice === 'join' ? 'primary' : 'danger'}
        onConfirm={async () => {
          if (!sheet) return;
          const { group, choice } = sheet;
          const ok = await actions.run(() =>
            actions.reply.mutateAsync({
              path: { party_id: group.id },
              body: { accept: choice === 'join' },
            }),
          );
          if (!ok) return;
          setSheet(null);
          if (choice === 'join') navigate(groupPath(group.id));
        }}
      >
        {actions.error ||
          (sheet?.choice === 'join'
            ? 'The organizer picks your seat. You check in yourself.'
            : '')}
      </DecisionSheet>
    </Screen>
  );
}
