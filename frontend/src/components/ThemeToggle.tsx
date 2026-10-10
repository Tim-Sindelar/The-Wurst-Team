import {
  ActionIcon,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { Icon } from './Icon';

/** Sun/moon button that switches the whole app between dark and light. */
export function ThemeToggle() {
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
