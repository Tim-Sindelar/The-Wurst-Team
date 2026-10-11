import {
  Alert,
  Anchor,
  Button,
  Card,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { DecisionSheet } from '../../components/DecisionSheet';
import { Icon } from '../../components/Icon';
import { notify } from '../../components/notify';
import {
  ActionBar,
  Screen,
  ScreenHeader,
  ScreenMain,
} from '../../components/Screen';
import { SeatChip } from '../../components/SeatChip';
import { SectionLabel } from '../../components/SectionLabel';
import { paths } from '../../routes';
import {
  declined,
  going,
  groupSummary,
  invited,
  memberOf,
  type Group,
} from './groups';
import { groupPath, groupSeatsPath, socialPaths } from './paths';
import {
  ActionError,
  PeopleList,
  PersonRow,
  SocialStatus,
} from './SocialParts';
import { useGroup, useInvitable, useSocialActions } from './useSocial';

type Sheet = 'join' | 'decline' | 'leave' | 'cancel';

/** One study party: who's going, inviting more, and the next step. */
export function GroupScreen() {
  const { groupId = '' } = useParams();
  const social = useGroup(groupId);
  const [search, setSearch] = useState('');
  const candidates = useInvitable(search);
  const actions = useSocialActions();
  const navigate = useNavigate();
  const [sheet, setSheet] = useState<Sheet | null>(null);

  const group = social.group;
  const userId = social.user?.id;
  const me = group ? memberOf(group, userId) : undefined;
  const organizer = group?.organizer_id === userId;
  const { reservation, held, running } = social.booking;
  const mySeat =
    reservation && (held || running) && me?.reservation_id === reservation.id
      ? reservation
      : null;
  const conflict =
    social.active && social.active.id !== group?.id ? social.active : null;
  const nameOf = (id: string) =>
    id === userId
      ? 'You'
      : (group?.members.find((member) => member.person.id === id)?.person
          .name ?? '');

  const header = (
    <ScreenHeader
      title="Study party"
      backTo={socialPaths.friends}
      backLabel="Back to friends"
    />
  );

  if (!group)
    return (
      <Screen>
        {header}
        <ScreenMain>
          <SocialStatus
            loading={social.loading}
            error={social.error}
            retry={social.missing ? undefined : social.retry}
            title={
              social.missing
                ? 'Study party not found'
                : "Couldn't load this study party"
            }
          />
        </ScreenMain>
      </Screen>
    );

  const confirm = async () => {
    if (!sheet) return;
    const choice = sheet;
    const path = { party_id: group.id };
    const ok = await actions.run(() =>
      choice === 'join' || choice === 'decline'
        ? actions.reply.mutateAsync({
            path,
            body: { accept: choice === 'join' },
          })
        : choice === 'leave'
          ? actions.leave.mutateAsync({ path })
          : actions.cancel.mutateAsync({ path }),
    );
    if (!ok) return;
    setSheet(null);
    if (choice === 'join') notify(`You joined ${group.name}`, 'userCheck');
    else {
      notify(
        choice === 'decline'
          ? 'Invitation declined'
          : choice === 'leave'
            ? `You left ${group.name}`
            : `${group.name} cancelled`,
      );
      navigate(socialPaths.friends);
    }
  };

  const invitable = candidates.people.filter(
    (person) =>
      !group.members.some(
        (member) =>
          member.person.id === person.id &&
          (member.status === 'accepted' || member.status === 'invited'),
      ),
  );
  const nobodyElse = going(group).length < 2;

  return (
    <Screen>
      {header}
      <ScreenMain>
        <Card component="section" aria-label="Study party">
          <div className="grid gap-1">
            <Title order={2} className="text-heading wrap-anywhere">
              {group.name}
            </Title>
            <Text size="sm" c="dimmed">
              {group.status === 'cancelled'
                ? 'Cancelled'
                : group.status === 'booked' && me?.seat
                  ? me.seat.room.name
                  : groupSummary(group)}
            </Text>
          </div>
        </Card>
        <ActionError
          error={sheet ? '' : actions.error || candidates.searchError}
        />

        {me?.status === 'invited' && conflict && (
          <Alert variant="danger" icon={<Icon name="alert" />}>
            <Text size="sm">
              You’re already in{' '}
              <Anchor component={Link} to={groupPath(conflict.id)}>
                {conflict.name}
              </Anchor>
            </Text>
          </Alert>
        )}

        {group.status === 'cancelled' && (
          <Alert icon={<Icon name="info" />} title="This party was cancelled">
            <Text size="sm">Seats nobody checked in to were released.</Text>
          </Alert>
        )}

        {group.status === 'booked' && (
          <BookedSeats group={group} userId={userId} mySeat={!!mySeat} />
        )}

        {group.status === 'open' && (
          <>
            <SectionLabel>Going</SectionLabel>
            <PeopleList label="Going">
              {going(group).map((member) => (
                <PersonRow
                  key={member.person.id}
                  person={member.person}
                  name={nameOf(member.person.id)}
                  detail={
                    member.person.id === group.organizer_id
                      ? 'Organizer'
                      : undefined
                  }
                />
              ))}
            </PeopleList>
            {invited(group).length > 0 && (
              <>
                <SectionLabel>Invited</SectionLabel>
                <PeopleList label="Invited">
                  {invited(group).map((member) => (
                    <PersonRow
                      key={member.person.id}
                      person={member.person}
                      name={nameOf(member.person.id)}
                    />
                  ))}
                </PeopleList>
              </>
            )}
            {organizer && (
              <>
                <SectionLabel>Invite more</SectionLabel>
                <TextInput
                  type="search"
                  placeholder="Search people"
                  aria-label="Search people"
                  leftSection={<Icon name="search" />}
                  maxLength={80}
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                />
                {invitable.length > 0 ? (
                  <PeopleList label="Invite more">
                    {invitable.map((person) => (
                      <PersonRow key={person.id} person={person}>
                        <Button
                          variant="secondary"
                          disabled={actions.busy}
                          aria-label={`Invite ${person.name}`}
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
                      </PersonRow>
                    ))}
                  </PeopleList>
                ) : candidates.searching ? (
                  <Text size="sm" c="dimmed" role="status">
                    Searching…
                  </Text>
                ) : (
                  search.trim() !== '' && (
                    <Text size="sm" c="dimmed" role="status">
                      No one found
                    </Text>
                  )
                )}
              </>
            )}
          </>
        )}

        {declined(group).length > 0 && group.status !== 'cancelled' && (
          <Text size="sm" c="dimmed">
            {declined(group)
              .map((member) => member.person.name.split(' ')[0])
              .join(', ')}{' '}
            declined.
          </Text>
        )}

        {organizer && group.status !== 'cancelled' && (
          <Button
            variant="danger"
            className="self-center"
            onClick={() => setSheet('cancel')}
          >
            {group.status === 'booked'
              ? 'Cancel booking'
              : 'Cancel study party'}
          </Button>
        )}
      </ScreenMain>

      <ActionBar>
        {group.status === 'cancelled' ? (
          <Button
            component={Link}
            to={socialPaths.newGroup}
            fullWidth
            leftSection={<Icon name="plus" />}
          >
            Start a study party
          </Button>
        ) : group.status === 'booked' ? (
          mySeat ? (
            <Button
              component={Link}
              to={running ? paths.session : paths.scan}
              fullWidth
              leftSection={!running && <Icon name="qr" />}
            >
              {running
                ? 'View session'
                : `Check in at seat ${mySeat.seat.label}`}
            </Button>
          ) : (
            <Button component={Link} to={socialPaths.friends} fullWidth>
              Back to friends
            </Button>
          )
        ) : me?.status === 'invited' ? (
          <>
            <Button
              fullWidth
              disabled={!!conflict || actions.busy}
              onClick={() => setSheet('join')}
            >
              Join group
            </Button>
            <Button
              variant="secondary"
              fullWidth
              disabled={actions.busy}
              onClick={() => setSheet('decline')}
            >
              Decline
            </Button>
          </>
        ) : organizer ? (
          <Button
            component={Link}
            to={groupSeatsPath(group.id)}
            fullWidth
            disabled={nobodyElse}
            leftSection={<Icon name="friends" />}
          >
            {nobodyElse
              ? 'Waiting for others to join'
              : `Choose seats for ${going(group).length}`}
          </Button>
        ) : (
          <Button
            variant="danger"
            fullWidth
            disabled={actions.busy}
            onClick={() => setSheet('leave')}
          >
            Leave study party
          </Button>
        )}
      </ActionBar>

      <DecisionSheet
        opened={!!sheet}
        onClose={() => {
          setSheet(null);
          actions.clearError();
        }}
        title={
          sheet === 'join'
            ? `Join ${group.name}?`
            : sheet === 'decline'
              ? `Decline ${group.name}?`
              : sheet === 'leave'
                ? `Leave ${group.name}?`
                : group.status === 'booked'
                  ? 'Cancel the booking?'
                  : `Cancel ${group.name}?`
        }
        safeLabel={sheet === 'cancel' ? 'Keep party' : 'Not now'}
        actionLabel={
          sheet === 'join'
            ? 'Join party'
            : sheet === 'decline'
              ? 'Decline'
              : sheet === 'leave'
                ? 'Leave party'
                : 'Cancel party'
        }
        actionTone={sheet === 'join' ? 'primary' : 'danger'}
        onConfirm={confirm}
      >
        {actions.error ||
          (sheet === 'join'
            ? `${nameOf(group.organizer_id)} picks your seat. You check in yourself.`
            : sheet === 'cancel' && group.status === 'booked'
              ? 'Seats nobody checked in to are released.'
              : '')}
      </DecisionSheet>
    </Screen>
  );
}

/** After booking: everyone's seat. Your own is marked as yours. */
function BookedSeats({
  group,
  userId,
  mySeat,
}: {
  group: Group;
  userId: string | undefined;
  mySeat: boolean;
}) {
  const seated = group.members.filter((member) => member.seat);
  return (
    <PeopleList label="Seats">
      {seated.map((member) => {
        const mine = member.person.id === userId;
        return (
          <PersonRow
            key={member.person.id}
            person={member.person}
            name={mine ? 'You' : member.person.name}
          >
            {mine && mySeat ? (
              <SeatChip state="yours">Seat {member.seat!.label}</SeatChip>
            ) : (
              <Text size="sm" className="font-semibold">
                Seat {member.seat!.label}
              </Text>
            )}
          </PersonRow>
        );
      })}
    </PeopleList>
  );
}
