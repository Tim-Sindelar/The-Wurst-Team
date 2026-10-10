/** Social features are on unless a build turns them off. */
export function resolveSocialEnabled(enabled: string | undefined) {
  return enabled !== 'false';
}
