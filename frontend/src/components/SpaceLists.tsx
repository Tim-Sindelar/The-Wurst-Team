import { Text } from '@mantine/core';
import type { SpaceRowData, StudySpace } from '../domain/space';
import { SectionLabel } from './SectionLabel';
import { SpaceCard } from './SpaceCard';

type SpaceListsProps = {
  /** Fit Home into its viewport; search results remain horizontally swipeable. */
  fit?: boolean;
  /** The spaces matching the search, best match first. */
  matches: StudySpace[];
  search: string;
  /** Favourites, recent and most popular, shown before anything is typed. */
  rows: SpaceRowData[];
  onToggleFavourite: (id: string, on: boolean) => void;
  /** Tapping a card calls this instead of opening the seat map (the campus map
      shows the space instead). */
  onSelect?: (space: StudySpace) => void;
};

/** The study space search results: swipeable rows before anything is typed,
    a plain list of matches while typing. Home and the campus map share it. */
export function SpaceLists({
  matches,
  fit = false,
  search,
  rows,
  onToggleFavourite,
  onSelect,
}: SpaceListsProps) {
  const card = (space: StudySpace) => (
    <SpaceCard
      space={space}
      onToggleFavourite={(on) => onToggleFavourite(space.id, on)}
      onSelect={onSelect && (() => onSelect(space))}
    />
  );

  if (search.trim() !== '')
    return matches.length === 0 ? (
      <Text c="dimmed" role="status">
        No study spaces match “{search.trim()}”.
      </Text>
    ) : (
      <ul
        className={
          fit
            ? 'flex min-h-0 gap-3 overflow-x-auto snap-x snap-mandatory p-1'
            : 'grid gap-3'
        }
        aria-label="Search results"
      >
        {matches.map((space) => (
          <li
            key={space.id}
            className={
              fit ? 'h-32 min-w-0 flex-[0_0_90%] snap-start' : undefined
            }
          >
            {card(space)}
          </li>
        ))}
      </ul>
    );

  if (rows.every((row) => row.spaces.length === 0))
    return (
      <Text c="dimmed" role="status">
        No study spaces yet.
      </Text>
    );

  return rows.map(
    (row) =>
      row.spaces.length > 0 && (
        <section
          key={row.id}
          aria-labelledby={`space-row-${row.id}`}
          className="grid gap-2"
        >
          <SectionLabel id={`space-row-${row.id}`}>{row.title}</SectionLabel>
          <ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pt-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {row.spaces.map((space) => (
              <li key={space.id} className="min-w-0 flex-[0_0_72%] snap-start">
                {card(space)}
              </li>
            ))}
          </ul>
        </section>
      ),
  );
}
