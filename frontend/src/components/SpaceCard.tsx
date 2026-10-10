import { ActionIcon, Anchor, Card, Title } from '@mantine/core';
import { Link } from 'react-router';
import type { StudySpace } from '../domain/space';
import { seatMapPath } from '../routes';
import { AvailabilityLabel } from './AvailabilityLabel';
import { cx } from './cx';
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
  const { photoUrl } = space;
  const onPhoto = photoUrl && 'text-on-photo';

  return (
    <Card
      component="article"
      className={cx(
        'relative isolate h-32 grid-cols-[minmax(0,1fr)] grid-rows-[1fr_auto] overflow-visible',
        onPhoto,
      )}
    >
      {/* The room photo, if there is one, always softly blurred and dimmed so the text
          stays readable. Without one the card is a plain surface card. */}
      {photoUrl && (
        <div
          className="absolute inset-0 -z-10 overflow-hidden rounded-[inherit]"
          aria-hidden="true"
        >
          <div
            className="absolute inset-0 scale-105 bg-cover bg-center blur-[2px]"
            style={{ backgroundImage: `url(${photoUrl})` }}
          />
          <div className="absolute inset-0 bg-photo-scrim" />
        </div>
      )}
      <div className="flex items-center justify-between gap-2 self-start">
        <Title order={2} className={cx('line-clamp-2 min-w-0 flex-1', onPhoto)}>
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
          className={cx('relative z-1 -my-2 -mr-2', onPhoto)}
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
