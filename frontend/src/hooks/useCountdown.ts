import { useEffect, useState } from 'react';

/** Seconds left, ticking down once a second from `start` until 0.
 *  Give the component using it a `key` to restart from a new value. */
export function useCountdown(start: number) {
  const [left, setLeft] = useState(start);

  useEffect(() => {
    const id = setInterval(() => {
      setLeft((value) => {
        if (value <= 1) clearInterval(id);
        return Math.max(0, value - 1);
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return left;
}

/** 9:05 → "09:05"; over an hour → "1:52:40". */
export function formatCountdown(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
