import {
  ActionIcon,
  Alert,
  Button,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router';
import type { SpaceSummary } from '../../api/generated';
import {
  getSpaceOptions,
  listSpacesOptions,
} from '../../api/generated/@tanstack/react-query.gen';
import { AvailabilityLabel } from '../../components/AvailabilityLabel';
import { DecisionSheet } from '../../components/DecisionSheet';
import { Icon } from '../../components/Icon';
import { notify } from '../../components/notify';
import { ActionBar, Screen, ScreenHeader } from '../../components/Screen';
import { SeatMap } from '../../components/seat-map/SeatMap';
import { SpaceLists } from '../../components/SpaceLists';
import { layoutSeats, roomTables } from '../../domain/room';
import { savedLayout } from '../admin/layoutDocument';
import { seatStateName } from '../../domain/seat';
import {
  describeAvailability,
  filterSpaces,
  spaceRows,
  toStudySpace,
} from '../../domain/space';
import { useFavourites } from '../../hooks/useFavourites';
import { usePopular } from '../../hooks/usePopular';
import { useRecents } from '../../hooks/useRecents';
import { useRules } from '../../hooks/useRules';
import { paths } from '../../routes';
import { going, initials, type Group } from './groups';
import { groupPath } from './paths';
import { seatTogether } from './seatTogether';
import { PersonAvatar, SocialStatus } from './SocialParts';
import { useGroup, useSocialActions } from './useSocial';

/** The organizer picks a room and a seat for everyone who joined, then books
    them all at once. */
export function GroupSeatsScreen() {
  const { groupId = '' } = useParams();
  const social = useGroup(groupId);
  const group = social.group;
  const header = (
    <ScreenHeader
      title="Book together"
      backTo={groupPath(groupId)}
      backLabel="Back to study group"
    />
  );
  if (!group)
    return (
      <Screen>
        {header}
        <div className="p-4">
          <SocialStatus
            loading={social.loading}
            error={social.error}
            retry={social.missing ? undefined : social.retry}
            title={
              social.missing
                ? 'Study group not found'
                : "Couldn't load this study group"
            }
          />
        </div>
      </Screen>
    );
  if (group.status !== 'open' || group.organizer_id !== social.user?.id)
    return <Navigate replace to={groupPath(group.id)} />;
  return <SeatPicker group={group} userId={social.user.id} />;
}

type Member = { id: string; name: string; initials: string };

function SeatPicker({ group, userId }: { group: Group; userId: string }) {
  const navigate = useNavigate();
  const actions = useSocialActions();
  const { rules } = useRules();
  const spacesQuery = useQuery({
    ...listSpacesOptions(),
    refetchInterval: 15_000,
  });
  const spaces = useMemo(
    () => spacesQuery.data?.spaces ?? [],
    [spacesQuery.data],
  );

  /* You first, then everyone else who joined. */
  const members: Member[] = going(group)
    .map(({ person }) => ({
      id: person.id,
      name: person.id === userId ? 'You' : person.name.split(' ')[0],
      initials: initials(person.name),
    }))
    .sort((a, b) => Number(b.id === userId) - Number(a.id === userId));
  const count = members.length;
  const fits = (space: SpaceSummary) =>
    space.is_open && space.free_seats >= count;

  /* ?room= when opened from a room's seat map. */
  const [searchParams] = useSearchParams();
  const [chosenRoom, setChosenRoom] = useState(searchParams.get('room') ?? '');
  const roomId =
    chosenRoom ||
    [...spaces].sort((a, b) => b.free_seats - a.free_seats).find(fits)?.id ||
    spaces[0]?.id ||
    '';
  const room = spaces.find((space) => space.id === roomId);
  const spaceQuery = useQuery({
    ...getSpaceOptions({ path: { space_id: roomId } }),
    enabled: !!roomId,
    refetchInterval: 15_000,
  });
  const space = spaceQuery.data?.space;

  /* member id -> seat id. A seat that stops being free drops out on its own. */
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [activeId, setActiveId] = useState(members[0]?.id ?? '');
  const [hint, setHint] = useState('');
  /* Once everyone has a seat: someone was picked to move (their name or seat tapped). */
  const [moving, setMoving] = useState(false);
  const [taken, setTaken] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);

  const layout = useMemo(() => savedLayout(space?.layout), [space?.layout]);
  const { plan, shown } = useMemo(
    () => layoutSeats(space?.seats ?? [], null, layout),
    [space?.seats, layout],
  );
  const freeIds = new Set(
    shown.filter((seat) => seat.state === 'free').map((seat) => seat.id),
  );
  const assigned: Record<string, string> = Object.fromEntries(
    Object.entries(picks).filter(
      ([memberId, seatId]) =>
        freeIds.has(seatId) && members.some((m) => m.id === memberId),
    ),
  );
  const ownerOf = (seatId: string) =>
    members.find((member) => assigned[member.id] === seatId);
  const complete = count > 0 && members.every((m) => assigned[m.id]);
  const active =
    members.find((member) => member.id === activeId) ??
    members.find((member) => !assigned[member.id]) ??
    members[0];

  const seats = shown.map((seat) =>
    ownerOf(seat.id) ? { ...seat, state: 'yours' as const } : seat,
  );
  const people = Object.fromEntries(
    members
      .filter((member) => assigned[member.id])
      .map((member) => [
        assigned[member.id],
        { initials: member.initials, name: member.name },
      ]),
  );

  const nextAfter = (memberId: string, picked: Record<string, string>) => {
    const order = members.map((member) => member.id);
    const from = order.indexOf(memberId);
    return [...order.slice(from + 1), ...order.slice(0, from)].find(
      (id) => !picked[id],
    );
  };

  const tapSeat = (seatId: string) => {
    setTaken(false);
    setHint('');
    const owner = ownerOf(seatId);
    if (owner) {
      if (!complete && owner.id === active.id) {
        /* Still picking: tap the current pick again to clear it. */
        const next = { ...assigned };
        delete next[owner.id];
        setPicks(next);
      } else if (complete && moving && owner.id === active.id) {
        setMoving(false);
      } else {
        /* Someone's seat: select them; their seat stays until a free one is tapped. */
        setActiveId(owner.id);
        if (complete) setMoving(true);
      }
      return;
    }
    const seat = shown.find((item) => item.id === seatId);
    if (!seat || seat.state !== 'free') {
      if (seat)
        setHint(
          `Seat ${seat.label} is ${seatStateName[seat.state].toLowerCase()}`,
        );
      return;
    }
    if (complete && !moving) return;
    const next = { ...assigned, [active.id]: seatId };
    setPicks(next);
    setMoving(false);
    /* Straight on to the next person without a seat. */
    const following = nextAfter(active.id, next);
    if (following) setActiveId(following);
  };

  const seatUsTogether = () => {
    setTaken(false);
    const free = shown.filter((seat) => seat.state === 'free');
    const together = seatTogether(free, count, roomTables);
    if (!together) {
      setHint('Not enough free seats here');
      return;
    }
    setHint('');
    setMoving(false);
    setPicks(
      Object.fromEntries(members.map((member, i) => [member.id, together[i]])),
    );
  };

  const chooseRoom = (id: string) => {
    if (id !== roomId) {
      setChosenRoom(id);
      setPicks({});
      setMoving(false);
      setActiveId(members[0]?.id ?? '');
    }
    setHint('');
    setTaken(false);
    setSearch('');
    setSearching(false);
    searchRef.current?.blur();
  };

  const book = async () => {
    const ok = await actions.run(
      () =>
        actions.book.mutateAsync({
          path: { party_id: group.id },
          body: {
            assignments: members.map((member) => ({
              user_id: member.id,
              seat_id: assigned[member.id],
            })),
          },
        }),
      (problem) => {
        /* Someone else was first: say so over the map and let them pick again. */
        if (problem.code === 'seat_unavailable') {
          setSheetOpen(false);
          setTaken(true);
          actions.clearError();
        }
      },
    );
    if (ok) {
      notify(`${group.name} is booked`, 'calendarCheck');
      navigate(paths.reservation);
    }
  };

  /* The picker card's height, so a chosen seat is centred above it. */
  const pickerRef = useRef<HTMLElement>(null);
  const covered = useRef(0);
  useLayoutEffect(() => {
    const node = pickerRef.current;
    if (!node) return;
    const report = () => {
      covered.current = node.offsetHeight;
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const level = room
    ? describeAvailability(room.free_seats, room.total_seats, room.is_open)
    : null;
  const left = members.filter((member) => !assigned[member.id]).length;

  return (
    <Screen className="h-dvh overflow-hidden">
      <ScreenHeader
        title={room?.name ?? 'Book together'}
        backTo={groupPath(group.id)}
        backLabel="Back to study group"
        subtitle={
          room &&
          level && (
            <AvailabilityLabel availability={level.availability} size="small">
              {room.is_open
                ? `${room.free_seats} free of ${room.total_seats} seats`
                : 'Closed right now'}
            </AvailabilityLabel>
          )
        }
      />

      {/* Home's search box. While it's in use, matching rooms cover the map. */}
      <div className="border-b border-border bg-bg px-4 py-3">
        <TextInput
          type="search"
          placeholder="Search study spaces"
          aria-label="Search study spaces"
          leftSection={<Icon name="search" />}
          ref={searchRef}
          rightSectionPointerEvents="all"
          rightSectionWidth={44}
          rightSection={
            searching && (
              <ActionIcon
                aria-label="Close search"
                /* Keep the box focused until the click lands. */
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseRoom(roomId)}
              >
                <Icon name="close" />
              </ActionIcon>
            )
          }
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            setSearching(true);
          }}
          onFocus={() => setSearching(true)}
          onBlur={() => setSearching(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') chooseRoom(roomId);
          }}
        />
      </div>

      <main className="relative min-h-0 flex-1">
        {searching && (
          <RoomResults
            spaces={spaces}
            search={search}
            count={count}
            onChoose={chooseRoom}
          />
        )}

        {spacesQuery.isError || spaceQuery.isError ? (
          <div className="p-4">
            <Alert
              variant="danger"
              role="alert"
              icon={<Icon name="alert" />}
              title="Couldn't load this room"
            >
              <Text size="sm">Check your connection and try again.</Text>
            </Alert>
          </div>
        ) : !space ? (
          <Text c="dimmed" role="status" className="p-4">
            Loading seats…
          </Text>
        ) : (
          // The pan and zoom measure the room once, so a new size remounts.
          <SeatMap
            key={plan ? `${plan.room.width}x${plan.room.height}` : 'stand-in'}
            plan={plan}
            seats={seats}
            selected={
              complete && !moving ? null : (assigned[active.id] ?? null)
            }
            onSelect={tapSeat}
            people={people}
            getCovered={() => covered.current}
          />
        )}

        {taken && (
          <div className="absolute inset-x-3 bottom-3 z-3">
            <Alert
              variant="danger"
              role="alert"
              icon={<Icon name="alert" />}
              title="A seat was just taken"
              className="shadow-card"
            >
              <Button
                variant="secondary"
                className="mt-2"
                onClick={() => setTaken(false)}
              >
                Choose another seat
              </Button>
            </Alert>
          </div>
        )}

        <section
          ref={pickerRef}
          aria-label="Seats for your group"
          className="absolute inset-x-0 bottom-0 z-2 grid gap-3 rounded-t-sheet border border-b-0 border-border bg-surface p-4 shadow-card"
        >
          <div className="flex items-center gap-3" aria-live="polite">
            {complete && !moving ? (
              <>
                <Icon name="check" className="text-accent" />
                <Title order={3} className="flex-1">
                  Everyone has a seat
                </Title>
              </>
            ) : (
              <div
                key={active.id}
                className="grid min-w-0 flex-1 animate-sheet-up"
              >
                <Text size="sm" c="dimmed">
                  {hint ||
                    (assigned[active.id]
                      ? 'Tap a free seat to move'
                      : 'Tap a free seat for')}
                </Text>
                <Title order={3} className="truncate">
                  {active.name}
                </Title>
              </div>
            )}
            <Button
              variant="secondary"
              leftSection={<Icon name="friends" size="sm" />}
              disabled={!space}
              onClick={seatUsTogether}
            >
              Seat us together
            </Button>
          </div>
          <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {members.map((member) => {
              const seatId = assigned[member.id];
              const seat = seatId && shown.find((item) => item.id === seatId);
              const pressed = (!complete || moving) && member.id === active.id;
              const person = going(group).find(
                (m) => m.person.id === member.id,
              )!.person;
              return (
                <li key={member.id} className="flex-none">
                  <UnstyledButton
                    className="flex min-h-11 items-center gap-2 rounded-card border border-border-strong bg-surface py-1 pr-3 pl-1 aria-pressed:border-accent aria-pressed:shadow-[inset_0_0_0_1px_var(--color-accent)]"
                    aria-pressed={pressed}
                    aria-label={`${member.name}, ${seat ? `seat ${seat.label}` : 'no seat yet'}`}
                    onClick={() => {
                      setHint('');
                      /* Everyone seated: select this person to move them
                         (tap again to let go). Their seat stays theirs. */
                      if (complete)
                        setMoving(!(moving && member.id === active.id));
                      setActiveId(member.id);
                    }}
                  >
                    <PersonAvatar person={person} size="sm" />
                    <span className="grid text-left leading-tight">
                      <span className="text-small font-semibold">
                        {member.name}
                      </span>
                      <span className="text-label text-text-muted">
                        {seat ? `Seat ${seat.label}` : 'No seat'}
                      </span>
                    </span>
                  </UnstyledButton>
                </li>
              );
            })}
          </ul>
        </section>
      </main>

      <ActionBar>
        <Button
          fullWidth
          disabled={!complete || !room?.is_open || actions.busy}
          onClick={() => {
            actions.clearError();
            setSheetOpen(true);
          }}
        >
          {complete
            ? `Reserve ${count} seats`
            : `Pick ${left} more seat${left === 1 ? '' : 's'}`}
        </Button>
      </ActionBar>

      <DecisionSheet
        opened={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          actions.clearError();
        }}
        title={`Reserve ${count} seats in ${room?.name ?? 'this room'}?`}
        safeLabel="Keep choosing"
        actionLabel={actions.busy ? 'Reserving…' : `Reserve ${count} seats`}
        onConfirm={book}
      >
        {actions.error || (
          <>
            {members
              .map((member) => {
                const seat = shown.find(
                  (item) => item.id === assigned[member.id],
                );
                return `${member.name}: seat ${seat?.label ?? ''}`;
              })
              .join(', ')}
            <br />
            Everyone checks in within {rules?.check_in_window_minutes ??
              15}{' '}
            minutes.
          </>
        )}
      </DecisionSheet>
    </Screen>
  );
}

/** The room search: Home's results (Favourites, Recent and Most popular rows,
    then the closest matches while typing), over the map while the box is in
    use. Rooms the whole group doesn't fit in say so. */
function RoomResults({
  spaces,
  search,
  count,
  onChoose,
}: {
  spaces: SpaceSummary[];
  search: string;
  count: number;
  onChoose: (id: string) => void;
}) {
  const favourites = useFavourites();
  const recents = useRecents();
  const popular = usePopular();
  const studySpaces = spaces.map((space) => {
    const card = toStudySpace(space, favourites.ids.has(space.id));
    if (space.is_open && space.free_seats < count)
      return {
        ...card,
        availability: 'none' as const,
        availabilityText: `${space.free_seats} free · too small`,
      };
    return card;
  });

  return (
    <div
      className="absolute inset-0 z-5 flex flex-col gap-4 overflow-y-auto bg-bg p-4"
      onMouseDown={(event) => event.preventDefault()}
    >
      <SpaceLists
        matches={filterSpaces(studySpaces, search)}
        search={search}
        rows={spaceRows(studySpaces, recents.ids, popular.ids)}
        onToggleFavourite={favourites.toggle}
        onSelect={(space) => onChoose(space.id)}
      />
    </div>
  );
}
