import {
  ActionIcon,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { Icon } from '../../components/Icon';

/** Sun/moon button in the admin header; the app itself switches theme on Profile. */
export function AdminThemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const light = useComputedColorScheme('dark') === 'light';

  return (
    <ActionIcon
      aria-pressed={light}
      aria-label={light ? 'Switch to dark theme' : 'Switch to light theme'}
      onClick={() => setColorScheme(light ? 'dark' : 'light')}
    >
      <Icon name={light ? 'sun' : 'moon'} />
    </ActionIcon>
  );
}
