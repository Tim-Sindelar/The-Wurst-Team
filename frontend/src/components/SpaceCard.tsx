import { ActionIcon, Anchor, Card, Title } from '@mantine/core';
import { useState } from 'react';
import { Link } from 'react-router';
import type { StudySpace } from '../mock/data';
import { paths } from '../routes';
import { AvailabilityLabel } from './AvailabilityLabel';
import { Icon } from './Icon';

/* Study-space card for the swipe row. The whole card opens the seat map
   through its title link; the favourite star sits above that link. */
export function SpaceCard({ space }: { space: StudySpace }) {
  const [favourite, setFavourite] = useState(space.favourite);

  return (
    <Card
      component="article"
      className="relative h-full grid-cols-[minmax(0,1fr)] grid-rows-[1fr_auto] overflow-visible"
    >
      <div className="flex items-center justify-between gap-2 self-start">
        <Title order={2} className="min-w-0 flex-1">
          <Anchor
            component={Link}
            to={paths.seatMap}
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
          onClick={() => setFavourite((value) => !value)}
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
