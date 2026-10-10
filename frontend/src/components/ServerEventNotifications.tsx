import { useReducedMotion } from '@mantine/hooks';
import { notifications, Notifications } from '@mantine/notifications';
import { Link } from 'react-router';
import { describeEvent } from '../domain/serverEvents';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useRefreshBooking } from '../hooks/useMyReservation';
import { useServerEvents } from '../hooks/useServerEvents';
import { Icon } from './Icon';

/** Shows what the server pushes as notification banners and refetches, so the
 * open screen catches up too. Rendered inside the router so a banner can link to its screen. */
export function ServerEventNotifications() {
  const { user } = useCurrentUser();
  const refresh = useRefreshBooking();
  const reduceMotion = useReducedMotion();

  useServerEvents(!!user, (event) => {
    void refresh();
    const notice = describeEvent(event);
    if (!notice) return;
    const id = notifications.show({
      icon: <Icon name={notice.icon} />,
      title: notice.link ? (
        <Link
          to={notice.link}
          className="ui-banner-link"
          onClick={() => notifications.hide(id)}
        >
          {notice.title}
        </Link>
      ) : (
        notice.title
      ),
      message: notice.message,
    });
  });

  return <Notifications transitionDuration={reduceMotion ? 0 : 250} />;
}
