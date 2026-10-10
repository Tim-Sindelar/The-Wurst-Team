/** Timing rules the API does not report. They mirror the backend defaults in
    backend/app/config.py; change both together. */
export const rules = {
  /** Time to check in once a reservation starts. */
  checkInMinutes: 10,
  /** Length of a session, and of one extension. */
  sessionMinutes: 120,
  /** From here to the end of a session, only its occupant can extend. */
  priorityWindowMinutes: 20,
  /** From here to the end of a session, others can reserve the next one. */
  publicWindowMinutes: 10,
};
