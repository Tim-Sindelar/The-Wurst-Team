import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ReservationImpact } from '../../api/generated';
export const adminHeaders = import.meta.env.DEV
  ? { 'X-Demo-Admin': 'true' }
  : undefined;
export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'detail' in error) {
    const d = error.detail;
    return typeof d === 'string' ? d : JSON.stringify(d);
  }
  return error instanceof Error
    ? error.message
    : 'The request failed. Please retry.';
}
export function useAdminAction() {
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [conflict, setConflict] = useState<{
      impacts: ReservationImpact[];
      retry: () => void;
    } | null>(null);
  async function run(
    action: (force: boolean) => Promise<unknown>,
    message: string,
    onDone?: () => void,
    force = false,
  ) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action(force);
      await cache.invalidateQueries();
      setConflict(null);
      setNotice(message);
      onDone?.();
    } catch (problem) {
      if (
        problem &&
        typeof problem === 'object' &&
        'reservation_impacts' in problem &&
        Array.isArray(problem.reservation_impacts)
      ) {
        setConflict({
          impacts: problem.reservation_impacts,
          retry: () => {
            void run(action, message, onDone, true);
          },
        });
      } else setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error, notice, setNotice, conflict, setConflict };
}
