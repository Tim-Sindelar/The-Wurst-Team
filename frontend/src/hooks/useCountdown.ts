import { useEffect, useState } from 'react';

/** Whole seconds until a deadline, rounded up, never below zero. */
export function secondsUntil(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** Fixed deadlines survive rerenders, navigation, reloads and background throttling. */
export function useCountdown(start: number, expiresAt?: number) {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  const deadline = expiresAt ?? startedAt + start * 1000;
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 250);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return Math.min(start, secondsUntil(deadline, now));
}

export function formatCountdown(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
