import { useEffect, useState } from 'react';

/**
 * The current time, refreshed each time a whole number of seconds remains
 * until `deadline`. Countdowns that share it change their digits together.
 */
export function useDeadlineClock(deadline: number | null) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      const t = Date.now();
      const phase =
        deadline === null ? 1000 : (((deadline - t) % 1000) + 1000) % 1000;
      timer = window.setTimeout(tick, phase || 1000);
    };
    const tick = () => {
      window.clearTimeout(timer);
      setNow(Date.now());
      schedule();
    };
    schedule();
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [deadline]);
  return now;
}
