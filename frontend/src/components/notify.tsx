import { notifications } from '@mantine/notifications';
import { Icon, type IconName } from './Icon';

/** Confirms something the user just did ("Friend request sent") with the same
    floating banner server events use. It sits below the header over the
    content, so nothing on the screen moves, and hides itself after a while. */
export function notify(title: string, icon: IconName = 'check') {
  notifications.show({ icon: <Icon name={icon} />, title, message: undefined });
}
