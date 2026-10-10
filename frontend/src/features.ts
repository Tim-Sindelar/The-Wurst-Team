/** Local development defaults on; deployed demos must opt in at build time. */
export const socialDemoEnabled =
  import.meta.env.VITE_SOCIAL_DEMO_ENABLED === undefined
    ? import.meta.env.DEV
    : import.meta.env.VITE_SOCIAL_DEMO_ENABLED === 'true';
