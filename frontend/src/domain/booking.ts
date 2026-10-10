import type { ReservationDetails } from '../api/generated';

/** Reserved, not yet checked in (or not yet started). */
export const isHeld = (reservation: ReservationDetails | null | undefined) =>
  reservation?.status === 'upcoming' || reservation?.status === 'pending';

/** Checked in: in session or on a break. */
export const isRunning = (reservation: ReservationDetails | null | undefined) =>
  reservation?.status === 'active' || reservation?.status === 'on_break';

/** Whole seconds from one ISO time to another. */
export const secondsBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 1000);

/** Moves a server timestamp onto this device's clock. `receivedAt` is when the
    response arrived here, so a wrong local clock cannot skew countdowns. */
export const toClientMs = (
  iso: string,
  serverTime: string,
  receivedAt: number,
) => Date.parse(iso) - Date.parse(serverTime) + receivedAt;

export type ApiProblem = { code: string | null; message: string };

const messages: Record<string, string> = {
  seat_unavailable: "That seat isn't available right now.",
  already_reserved: 'You already have a reservation.',
  too_early: "Your reservation hasn't started yet.",
  qr_not_found: "That code isn't a seat code.",
  extension_unavailable: "This session can't be extended right now.",
  invalid_state: "That isn't possible right now.",
  break_budget_exhausted: "You've used all of your break time.",
  not_found: "We couldn't find that.",
};

/** Turns whatever a failed API call threw into a code and a sentence to show. */
export function apiProblem(error: unknown): ApiProblem {
  if (typeof error === 'object' && error !== null) {
    const { code, detail } = error as { code?: unknown; detail?: unknown };
    if (typeof code === 'string') {
      const message =
        messages[code] ?? (typeof detail === 'string' ? detail : null);
      if (message) return { code, message };
    }
    if (typeof detail === 'string') return { code: null, message: detail };
  }
  return { code: null, message: 'Something went wrong. Try again.' };
}
