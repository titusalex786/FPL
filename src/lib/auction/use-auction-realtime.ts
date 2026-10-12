'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  subscribeToAuctionRealtime,
  type AuctionRealtimeStatus,
} from '@/lib/auction/realtime-sync';

export type AuctionConnectionStatus =
  | AuctionRealtimeStatus
  | 'OFFLINE';

export function useAuctionRealtime(
  auctionId: string,
  refresh: () => void | Promise<unknown>,
  fallbackIntervalMs = 10000
) {
  const [status, setStatus] = useState<AuctionConnectionStatus>(
    typeof navigator !== 'undefined' && !navigator.onLine
      ? 'OFFLINE'
      : 'CONNECTING'
  );
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const client = createClient();
    const unsubscribe = subscribeToAuctionRealtime(client, auctionId, {
      refresh: () => refreshRef.current(),
      status: (nextStatus) => {
        setStatus(
          typeof navigator !== 'undefined' && !navigator.onLine
            ? 'OFFLINE'
            : nextStatus
        );
      },
    });

    const onOffline = () => setStatus('OFFLINE');
    const onOnline = () => {
      setStatus('RECONNECTING');
      void refreshRef.current();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshRef.current();
      }
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      unsubscribe();
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [auctionId]);

  useEffect(() => {
    if (status === 'LIVE') return;
    const poll = () => {
      if (
        document.visibilityState === 'visible' &&
        typeof navigator !== 'undefined' &&
        navigator.onLine
      ) {
        void refreshRef.current();
      }
    };
    const timer = window.setInterval(poll, fallbackIntervalMs);
    return () => window.clearInterval(timer);
  }, [fallbackIntervalMs, status]);

  return status;
}
