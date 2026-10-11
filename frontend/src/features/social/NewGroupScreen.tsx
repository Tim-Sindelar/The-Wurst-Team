import { Button, Card, Checkbox, Text, TextInput, Title } from '@mantine/core';
import { useState } from 'react';
import type { SocialPerson } from '../../api/generated';
import { Navigate, useNavigate } from 'react-router';
import { Icon } from '../../components/Icon';
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
import { useGroups, useInvitable, useSocialActions } from './useSocial';

/** Name a group and pick who comes, in one step. A cancelled group can be
    filled back in with one tap. Anyone can be invited, friend or not. */
export function NewGroupScreen() {
  const groups = useGroups();
  const actions = useSocialActions();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<SocialPerson[]>([]);
  const [search, setSearch] = useState('');
  const social = useInvitable(search);

  if (groups.active)
    return <Navigate replace to={groupPath(groups.active.id)} />;

  const last = groups.lastCancelled;
  const lastPeople = last?.people;
  const isPicked = (person: SocialPerson) =>
    picked.some((other) => other.id === person.id);
  const reused =
    !!last &&
    !!lastPeople &&
    name === last.name &&
    picked.length === lastPeople.length &&
    lastPeople.every(isPicked);
  const named = name.trim() !== '';
  const typing = search.trim() !== '';
  /* Before typing: whoever is picked but not a friend, then every friend. */
  const shown = typing
    ? social.people
    : [
        ...picked.filter(
          (person) => !social.people.some((other) => other.id === person.id),
        ),
        ...social.people,
      ];

  const create = async () => {
    if (!named) return;
    let id = '';
    await actions.run(async () => {
      const group = await actions.createGroup.mutateAsync({
        body: { name: name.trim() },
      });
      id = group.id;
      for (const person of picked)
        await actions.invite.mutateAsync({
          path: { party_id: group.id },
          body: { user_id: person.id },
        });
    });
    /* The group exists even if an invitation failed: open it, the error shows there. */
    if (id) navigate(groupPath(id), { replace: true });
  };

  return (
    <Screen>
      <ScreenHeader
        title="New study party"
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
        <ActionError error={actions.error || social.searchError} />

        {last && lastPeople && (
          <>
            <SectionLabel>Last party</SectionLabel>
            <Card component="section" aria-label={`${last.name}, cancelled`}>
              <div className="flex items-center justify-between gap-3">
                <div className="grid min-w-0 gap-1">
                  <Title order={2} className="wrap-anywhere">
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
                    setPicked(lastPeople);
                  }}
                >
                  {reused ? 'Filled in' : 'Use again'}
                </Button>
              </div>
              <AvatarStack people={lastPeople} />
            </Card>
            <SectionLabel>New party</SectionLabel>
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

        <SectionLabel>
          Invite{picked.length ? ` · ${picked.length}` : ''}
        </SectionLabel>
        <TextInput
          type="search"
          placeholder="Search people"
          aria-label="Search people"
          leftSection={<Icon name="search" />}
          maxLength={80}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
        {shown.length > 0 ? (
          <PeopleList label="Invite people">
            {shown.map((person) => (
              <li key={person.id}>
                <label className="flex min-h-15 cursor-pointer items-center gap-3 py-2 pr-4 pl-4 hover:bg-hover">
                  <PersonAvatar person={person} />
                  <Text className="min-w-0 flex-1 font-medium wrap-anywhere">
                    {person.name}
                  </Text>
                  <Checkbox
                    aria-label={`Invite ${person.name}`}
                    checked={isPicked(person)}
                    onChange={(event) => {
                      const on = event.currentTarget.checked;
                      setPicked((people) =>
                        on
                          ? [...people, person]
                          : people.filter((other) => other.id !== person.id),
                      );
                    }}
                  />
                </label>
              </li>
            ))}
          </PeopleList>
        ) : social.searching ? (
          <Text size="sm" c="dimmed" role="status">
            Searching…
          </Text>
        ) : (
          typing && (
            <Text size="sm" c="dimmed" role="status">
              No one found
            </Text>
          )
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
            ? 'Name your party'
            : picked.length
              ? `Create and invite ${picked.length}`
              : 'Create study party'}
        </Button>
      </ActionBar>
    </Screen>
  );
}
