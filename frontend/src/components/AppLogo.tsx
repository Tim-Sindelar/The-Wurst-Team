import { useComputedColorScheme } from '@mantine/core';
import darkLogo from '../assets/branding/study-spaces-logo-dark.png';
import lightLogo from '../assets/branding/study-spaces-logo-light.png';

/** The supplied wordmarks retain their original transparent canvas. */
export function AppLogo() {
  const light = useComputedColorScheme('dark') === 'light';
  return (
    <img
      src={light ? lightLogo : darkLogo}
      alt="Academic Study Spaces"
      className="block h-8 w-full max-w-42 object-cover"
    />
  );
}
