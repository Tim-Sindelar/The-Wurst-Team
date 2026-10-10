import {
  Switch,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';

/** Dark-theme switch: flips the whole app between dark and light. */
export function ThemeSwitch() {
  const { setColorScheme } = useMantineColorScheme();
  const dark = useComputedColorScheme('dark') === 'dark';

  return (
    <Switch
      label="Dark theme"
      checked={dark}
      onChange={(event) =>
        setColorScheme(event.currentTarget.checked ? 'dark' : 'light')
      }
    />
  );
}
