import { ActionIcon, Anchor, Card, Title } from '@mantine/core';
import { Link } from 'react-router';
import type { StudySpace } from '../domain/space';
import { seatMapPath } from '../routes';
import { AvailabilityLabel } from './AvailabilityLabel';
import { Icon } from './Icon';

/* Study-space card for the swipe rows. Every card has the same fixed height
   (names clamp to two lines) so rows and cards line up. The whole card opens the seat map
   through its title link; the favourite star sits above that link. */
type SpaceCardProps = {
  space: StudySpace;
  onToggleFavourite: (favourite: boolean) => void;
};

export function SpaceCard({ space, onToggleFavourite }: SpaceCardProps) {
  const favourite = space.favourite;

  return (
    <Card
      component="article"
      className="relative h-32 grid-cols-[minmax(0,1fr)] grid-rows-[1fr_auto] overflow-visible"
    >
      <div className="flex items-center justify-between gap-2 self-start">
        <Title order={2} className="line-clamp-2 min-w-0 flex-1">
          <Anchor
            component={Link}
            to={seatMapPath(space.id)}
            underline="never"
            className="[font:inherit] text-inherit [overflow-wrap:anywhere] after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus"
          >
            {space.name}
          </Anchor>
        </Title>
        <ActionIcon
          className="relative z-1 -my-2 -mr-2 text-text-muted aria-pressed:text-accent"
          aria-pressed={favourite}
          aria-label={`Favourite ${space.name}`}
          onClick={() => onToggleFavourite(!favourite)}
        >
          <Icon name="star" filled={favourite} />
        </ActionIcon>
      </div>
      <AvailabilityLabel availability={space.availability}>
        {space.availabilityText}
      </AvailabilityLabel>
    </Card>
  );
}
