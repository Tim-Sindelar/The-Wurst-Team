/* The app's name as the logo: the seat mark (a desk with four
   seats, one free) and the wordmark, "Study" bold and "Spaces" regular.
   Put it inside a heading; it takes the heading's size. */
export function AppName() {
  return (
    <span className="inline-flex items-baseline gap-[0.3em]">
      {/* Cap height tall and sat on the baseline, so it lines up with the letters. */}
      <svg
        viewBox="72 68 112 120"
        className="h-[0.7em] w-auto shrink-0 fill-seat-occupied"
        aria-hidden="true"
      >
        <rect x="72" y="111" width="112" height="34" rx="12" />
        <rect
          x="88"
          y="68"
          width="34"
          height="34"
          rx="9"
          className="fill-seat-free"
        />
        <rect x="134" y="68" width="34" height="34" rx="9" />
        <rect x="88" y="154" width="34" height="34" rx="9" />
        <rect x="134" y="154" width="34" height="34" rx="9" />
      </svg>
      <span className="[word-spacing:-0.1em]">
        <span className="font-bold">Study</span>{' '}
        <span className="font-normal">Spaces</span>
      </span>
    </span>
  );
}
