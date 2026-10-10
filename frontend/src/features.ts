import { resolveSocialEnabled } from './domain/socialMode';

export const socialEnabled = resolveSocialEnabled(
  import.meta.env.VITE_SOCIAL_ENABLED,
);
