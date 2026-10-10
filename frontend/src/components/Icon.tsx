import type { SVGProps } from 'react';

/* The design's one icon set: 24px outline, 1.75px stroke, drawn in currentColor.
   Add new icons here only, with the same stroke settings. */
const paths = {
  alert: (
    <>
      <path d="M12 3L2.5 20h19z" />
      <path d="M12 10v4.5M12 17.5v.01" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  chevronRight: <path d="M9 5l7 7-7 7" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  coffee: (
    <>
      <path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9z" />
      <path d="M16 11h2a2.5 2.5 0 0 1 0 5h-2" />
      <path d="M8 3v2M12 3v2" />
    </>
  ),
  fitRoom: (
    <>
      <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
      <rect x="8" y="8" width="8" height="8" rx="1" />
    </>
  ),
  flashlight: <path d="M7 3h10l-1 5H8zM8 8h8v3l-1.5 2v8h-5v-8L8 11z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.01" />
    </>
  ),
  map: (
    <>
      <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" />
      <path d="M9 4v14M15 6v14" />
    </>
  ),
  /* Five-pip die: rounded square, bold filled pips so it stays crisp at 24px. */
  dice: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <g fill="currentColor" stroke="none">
        <circle cx="8.5" cy="8.5" r="1.4" />
        <circle cx="15.5" cy="8.5" r="1.4" />
        <circle cx="12" cy="12" r="1.4" />
        <circle cx="8.5" cy="15.5" r="1.4" />
        <circle cx="15.5" cy="15.5" r="1.4" />
      </g>
    </>
  ),
  door: (
    <>
      <path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17" />
      <path d="M3 21h18M15 12v.01" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 12.5l9 5 9-5M3 17l9 5 9-5" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />,
  pin: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  qr: (
    <>
      <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3z" />
      <path d="M14 14h2v2h-2zM19 14h2M14 19h2M18 18h3v3h-3z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5L21 21" />
    </>
  ),
  seat: <path d="M7 4h10v8H7zM5 12h14v4H5zM8 16v4M16 16v4" />,
  star: (
    <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
};

export type IconName = keyof typeof paths;

type IconProps = Omit<SVGProps<SVGSVGElement>, 'name'> & {
  name: IconName;
  /** 24px by default; `sm` is 16px, `xs` 12px (seat badges), `lg` 40px. */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** Fill the shape too (the selected favourite star). */
  filled?: boolean;
};

const sizes = { xs: 12, sm: 16, md: 24, lg: 40 };

export function Icon({
  name,
  size = 'md',
  filled = false,
  ...props
}: IconProps) {
  const px = sizes[size];
  return (
    <svg
      viewBox="0 0 24 24"
      width={px}
      height={px}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="flex-none"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
