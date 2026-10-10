import { useEffect, useEffectEvent } from 'react';
import type { ServerEvent } from '../api/generated';
import { eventsUrl, reconnectDelay } from '../domain/serverEvents';

const apiBase = import.meta.env.VITE_API_BASE_URL || import.meta.env.BASE_URL;

/** Keeps the /api/v1/events WebSocket open while `enabled` and hands every
 * event except heartbeats to `onEvent`. Reconnects with backoff, and at once
 * when the device comes back online or the app is shown again. */
export function useServerEvents(
  enabled: boolean,
  onEvent: (event: ServerEvent) => void,
) {
  const handle = useEffectEvent(onEvent);

  useEffect(() => {
    if (!enabled) return;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;

    const connect = () => {
      clearTimeout(retry);
      if (stopped || socket) return;
      const current = new WebSocket(eventsUrl(apiBase, window.location));
      socket = current;
      current.onopen = () => {
        attempt = 0;
      };
      current.onmessage = (message) => {
        let event: ServerEvent;
        try {
          event = JSON.parse(message.data as string) as ServerEvent;
        } catch {
          return;
        }
        if (event.type !== 'ping') handle(event);
      };
      current.onclose = () => {
        if (socket !== current) return;
        socket = undefined;
        if (!stopped) retry = setTimeout(connect, reconnectDelay(attempt++));
      };
    };
    const reconnectNow = () => {
      if (document.visibilityState === 'visible') connect();
    };

    connect();
    window.addEventListener('online', reconnectNow);
    document.addEventListener('visibilitychange', reconnectNow);
    return () => {
      stopped = true;
      clearTimeout(retry);
      window.removeEventListener('online', reconnectNow);
      document.removeEventListener('visibilitychange', reconnectNow);
      socket?.close();
    };
  }, [enabled]);
}
