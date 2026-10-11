import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';

/** Goes back one step in the app's history, like the browser's back button.
    When the app was opened on this screen (a link, a QR code, a reload of the
    first page), there is nothing to go back to, so it goes to `fallback`. */
export function useGoBack(fallback: string) {
  const navigate = useNavigate();
  const { key } = useLocation();
  // React Router gives the entry the app started on the key 'default'.
  const hasHistory = key !== 'default';
  return useCallback(() => {
    if (hasHistory) void navigate(-1);
    else void navigate(fallback, { replace: true });
  }, [hasHistory, navigate, fallback]);
}
