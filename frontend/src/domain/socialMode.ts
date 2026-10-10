/** The live feature and sample data are separate switches. Samples never default
 * on in a deployed build, even when the backend is unavailable. */
export function resolveSocialMode(
  enabled: string | undefined,
  demo: string | undefined,
  development = false,
) {
  const socialEnabled = enabled !== 'false';
  return {
    enabled: socialEnabled,
    demo: socialEnabled && (demo === undefined ? development : demo === 'true'),
  };
}
