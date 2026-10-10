import { useState } from 'react';

const defaults = { checkIn: true, extension: true, seatFree: true };
type Preferences = typeof defaults;

/** These notification controls are local preferences until delivery is implemented. */
export function useNotificationPreferences(userId: string) {
  const key = `study-spaces:notifications:${userId}`;
  const [error, setError] = useState('');
  const [preferences, setPreferences] = useState<Preferences>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
      return Object.fromEntries(
        Object.entries(defaults).map(([name, value]) => [
          name,
          typeof saved?.[name] === 'boolean' ? saved[name] : value,
        ]),
      ) as Preferences;
    } catch {
      return defaults;
    }
  });
  const update = (name: keyof Preferences, checked: boolean) => {
    const next = { ...preferences, [name]: checked };
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setPreferences(next);
      setError('');
    } catch {
      setError(
        'Could not save this preference on your device. Please try again.',
      );
    }
  };
  return { preferences, update, error };
}
