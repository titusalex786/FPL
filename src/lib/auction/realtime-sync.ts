import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from '@supabase/supabase-js';

export type AuctionRealtimeStatus = 'CONNECTING' | 'LIVE' | 'RECONNECTING';

type AuctionRealtimeListener = {
  refresh: () => void | Promise<unknown>;
  status: (status: AuctionRealtimeStatus) => void;
};

type AuctionRealtimeEntry = {
  channel: RealtimeChannel;
  listeners: Set<AuctionRealtimeListener>;
  refreshState: Map<AuctionRealtimeListener, { running: boolean; queued: boolean }>;
  seenEvents: Set<string>;
  pendingTimer: ReturnType<typeof setTimeout> | null;
  status: AuctionRealtimeStatus;
  hasConnected: boolean;
};

type AuctionRealtimePayload = RealtimePostgresChangesPayload<Record<string, unknown>>;

const entriesByClient = new WeakMap<
  SupabaseClient,
  Map<string, AuctionRealtimeEntry>
>();

function recordForPayload(payload: AuctionRealtimePayload) {
  if (payload.eventType === 'DELETE') return payload.old;
  return payload.new;
}

function eventKey(payload: AuctionRealtimePayload) {
  const record = recordForPayload(payload);
  const recordId = typeof record.id === 'string' ? record.id : 'unknown';
  return [
    payload.schema,
    payload.table,
    payload.eventType,
    recordId,
    payload.commit_timestamp,
  ].join(':');
}

function isForAuction(
  payload: AuctionRealtimePayload,
  auctionId: string
) {
  const record = recordForPayload(payload);
  if (payload.table === 'auctions') return record.id === auctionId;
  return record.auction_id === auctionId;
}

function notifyStatus(entry: AuctionRealtimeEntry, status: AuctionRealtimeStatus) {
  entry.status = status;
  for (const listener of entry.listeners) listener.status(status);
}

function requestAuthoritativeRefresh(entry: AuctionRealtimeEntry) {
  for (const listener of entry.listeners) {
    requestOneAuthoritativeRefresh(entry, listener);
  }
}

function requestOneAuthoritativeRefresh(
  entry: AuctionRealtimeEntry,
  listener: AuctionRealtimeListener
) {
  const state = entry.refreshState.get(listener);
  if (!state) return;
  if (state.running) {
    state.queued = true;
    return;
  }

  state.running = true;
  void Promise.resolve()
    .then(() => listener.refresh())
    .catch((error: unknown) => {
      console.error('Auction realtime refresh failed', error);
    })
    .finally(() => {
      state.running = false;
      if (state.queued && entry.listeners.has(listener)) {
        state.queued = false;
        requestOneAuthoritativeRefresh(entry, listener);
      }
    });
}

function handleDatabaseEvent(
  entry: AuctionRealtimeEntry,
  auctionId: string,
  payload: AuctionRealtimePayload
) {
  if (
    (payload.table !== 'auctions' && payload.table !== 'auction_lots' && payload.table !== 'auction_events') ||
    !isForAuction(payload, auctionId)
  ) {
    return;
  }

  const key = eventKey(payload);
  if (entry.seenEvents.has(key)) return;
  entry.seenEvents.add(key);
  if (entry.seenEvents.size > 500) {
    const oldestKey = entry.seenEvents.values().next().value;
    if (oldestKey) entry.seenEvents.delete(oldestKey);
  }

  if (entry.pendingTimer) clearTimeout(entry.pendingTimer);
  entry.pendingTimer = setTimeout(() => {
    entry.pendingTimer = null;
    requestAuthoritativeRefresh(entry);
  }, 50);
}

function createEntry(
  client: SupabaseClient,
  auctionId: string
): AuctionRealtimeEntry {
  const entry = {
    channel: null as unknown as RealtimeChannel,
    listeners: new Set<AuctionRealtimeListener>(),
    refreshState: new Map(),
    seenEvents: new Set<string>(),
    pendingTimer: null,
    status: 'CONNECTING' as AuctionRealtimeStatus,
    hasConnected: false,
  };

  const onChange = (payload: AuctionRealtimePayload) =>
    handleDatabaseEvent(entry, auctionId, payload);

  entry.channel = client
    .channel(`auction-sync:${auctionId}`)
    .on(
      'broadcast',
      { event: 'AUCTION_STATE_CHANGED' },
      () => {
        requestAuthoritativeRefresh(entry);
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'auctions',
        filter: `id=eq.${auctionId}`,
      },
      onChange
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'auction_lots',
        filter: `auction_id=eq.${auctionId}`,
      },
      onChange
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'auction_lots',
        filter: `auction_id=eq.${auctionId}`,
      },
      onChange
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'auction_events',
        filter: `auction_id=eq.${auctionId}`,
      },
      onChange
    )
    .subscribe((state) => {
      if (state === 'SUBSCRIBED') {
        notifyStatus(entry, 'LIVE');
        if (entry.hasConnected) requestAuthoritativeRefresh(entry);
        entry.hasConnected = true;
      } else if (
        state === 'CHANNEL_ERROR' ||
        state === 'TIMED_OUT' ||
        state === 'CLOSED'
      ) {
        notifyStatus(entry, 'RECONNECTING');
      }
    });

  return entry;
}

export function subscribeToAuctionRealtime(
  client: SupabaseClient,
  auctionId: string,
  listener: AuctionRealtimeListener
) {
  let entries = entriesByClient.get(client);
  if (!entries) {
    entries = new Map<string, AuctionRealtimeEntry>();
    entriesByClient.set(client, entries);
  }

  let entry = entries.get(auctionId);
  if (!entry) {
    entry = createEntry(client, auctionId);
    entries.set(auctionId, entry);
  }
  entry.listeners.add(listener);
  entry.refreshState.set(listener, { running: false, queued: false });
  listener.status(entry.status);
  requestOneAuthoritativeRefresh(entry, listener);

  return () => {
    const currentEntry = entries?.get(auctionId);
    if (!currentEntry) return;
    currentEntry.listeners.delete(listener);
    currentEntry.refreshState.delete(listener);
    if (currentEntry.listeners.size > 0) return;

    if (currentEntry.pendingTimer) clearTimeout(currentEntry.pendingTimer);
    entries?.delete(auctionId);
    void client.removeChannel(currentEntry.channel);
  };
}
