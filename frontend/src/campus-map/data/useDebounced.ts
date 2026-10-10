import { useEffect, useState } from 'react';

/** `value` once it has stayed the same for `ms` (null and undefined are passed on at once). */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (value == null) {
      setSettled(value);
      return;
    }
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
