import { useReducedMotion } from '@mantine/hooks';
import { notifications, Notifications } from '@mantine/notifications';
import { Link, useLocation } from 'react-router';
import { describeEvent, shownOnScreen } from '../domain/serverEvents';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useRefreshBooking } from '../hooks/useMyReservation';
import { useServerEvents } from '../hooks/useServerEvents';
import { Icon } from './Icon';

/** Refetches on every server event, so the open screen catches up, and shows a
 * notification banner unless that screen already shows the change. Rendered
 * inside the router so a banner can link to its screen. */
export function ServerEventNotifications() {
  const { user } = useCurrentUser();
  const refresh = useRefreshBooking();
  const reduceMotion = useReducedMotion();
  const { pathname } = useLocation();

  useServerEvents(!!user, (event) => {
    void refresh();
    const notice = describeEvent(event);
    if (!notice || shownOnScreen(notice, pathname)) return;
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
