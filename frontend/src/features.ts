import { resolveSocialMode } from './domain/socialMode';

const social = resolveSocialMode(
  import.meta.env.VITE_SOCIAL_ENABLED,
  import.meta.env.VITE_SOCIAL_DEMO_ENABLED,
  import.meta.env.DEV,
);
export const socialEnabled = social.enabled;
export const socialDemoEnabled = social.demo;
