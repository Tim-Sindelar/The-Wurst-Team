import { Button, Card, Checkbox, Text, TextInput, Title } from '@mantine/core';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Icon } from '../../components/Icon';
import { notify } from '../../components/notify';
import {
  ActionBar,
  Screen,
  ScreenHeader,
  ScreenMain,
} from '../../components/Screen';
import { SectionLabel } from '../../components/SectionLabel';
import { groupPath, socialPaths } from './paths';
import {
  ActionError,
  AvatarStack,
  PeopleList,
  PersonAvatar,
  SocialStatus,
} from './SocialParts';
import { useFriends, useGroups, useSocialActions } from './useSocial';

/** Name a group and pick who comes, in one step. A cancelled group can be
    filled back in with one tap. */
export function NewGroupScreen() {
  const social = useFriends();
  const groups = useGroups();
  const actions = useSocialActions();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  if (groups.active)
    return <Navigate replace to={groupPath(groups.active.id)} />;

  const last = groups.lastCancelled;
  const friendIds = new Set(social.friends.map((friend) => friend.person.id));
  const lastPeople = last?.people.filter((person) => friendIds.has(person.id));
  const reused =
    !!last &&
    !!lastPeople &&
    name === last.name &&
    picked.length === lastPeople.length &&
    lastPeople.every((person) => picked.includes(person.id));
  const named = name.trim() !== '';

  const create = async () => {
    if (!named) return;
    let id = '';
    const ok = await actions.run(async () => {
      const group = await actions.createGroup.mutateAsync({
        body: { name: name.trim() },
      });
      id = group.id;
      for (const user_id of picked)
        await actions.invite.mutateAsync({
          path: { party_id: group.id },
          body: { user_id },
        });
    });
    /* The group exists even if an invitation failed: open it, the error shows there. */
    if (id) {
      if (ok)
        notify(
          picked.length
            ? `${name.trim()} created · ${picked.length} invited`
            : `${name.trim()} created`,
        );
      navigate(groupPath(id));
    }
  };

  return (
    <Screen>
      <ScreenHeader
        title="New study group"
        backTo={socialPaths.friends}
        backLabel="Back to friends"
      />
      <ScreenMain>
        <SocialStatus
          loading={social.loading || groups.loading}
          error={social.error || groups.error}
          retry={() => {
            social.retry();
            groups.retry();
          }}
        />
        <ActionError error={actions.error} />

        {last && lastPeople && (
          <>
            <SectionLabel>Last group</SectionLabel>
            <Card component="section" aria-label={`${last.name}, cancelled`}>
              <div className="flex items-center justify-between gap-3">
                <div className="grid min-w-0 gap-1">
                  <Title order={2} className="break-words">
                    {last.name}
                  </Title>
                  <Text size="sm" c="dimmed">
                    Cancelled
                  </Text>
                </div>
                <Button
                  variant="secondary"
                  aria-pressed={reused}
                  leftSection={reused && <Icon name="check" size="sm" />}
                  onClick={() => {
                    setName(last.name);
                    setPicked(lastPeople.map((person) => person.id));
                  }}
                >
                  {reused ? 'Filled in' : 'Use again'}
                </Button>
              </div>
              <AvatarStack people={lastPeople} />
            </Card>
            <SectionLabel>New group</SectionLabel>
          </>
        )}

        <form
          id="new-group"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <TextInput
            label={
              <>
                Group name
                <span className="font-normal text-text-muted">Required</span>
              </>
            }
            labelProps={{ className: 'flex w-full justify-between' }}
            required
            withAsterisk={false}
            maxLength={80}
            placeholder="e.g. Exam prep"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </form>

        {social.friends.length > 0 && (
          <>
            <SectionLabel>
              Invite{picked.length ? ` · ${picked.length}` : ''}
            </SectionLabel>
            <PeopleList label="Invite friends">
              {social.friends.map(({ person }) => (
                <li key={person.id}>
                  <label className="flex min-h-15 cursor-pointer items-center gap-3 py-2 pr-4 pl-4 hover:bg-hover">
                    <PersonAvatar person={person} />
                    <Text className="min-w-0 flex-1 font-medium break-words">
                      {person.name}
                    </Text>
                    <Checkbox
                      aria-label={`Invite ${person.name}`}
                      checked={picked.includes(person.id)}
                      onChange={(event) => {
                        const on = event.currentTarget.checked;
                        setPicked((ids) =>
                          on
                            ? [...ids, person.id]
                            : ids.filter((id) => id !== person.id),
                        );
                      }}
                    />
                  </label>
                </li>
              ))}
            </PeopleList>
          </>
        )}
      </ScreenMain>

      <ActionBar>
        <Button
          type="submit"
          form="new-group"
          fullWidth
          disabled={!named || actions.busy}
          loading={actions.busy}
        >
          {!named
            ? 'Name your group'
            : picked.length
              ? `Create and invite ${picked.length}`
              : 'Create study group'}
        </Button>
      </ActionBar>
    </Screen>
  );
}
