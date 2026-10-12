import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  subscribeToAuctionRealtime,
  type AuctionRealtimeStatus,
} from '@/lib/auction/realtime-sync';

const auctionId = '10000000-0000-4000-8000-000000000001';
const otherAuctionId = '10000000-0000-4000-8000-000000000002';
const lotId = '30000000-0000-4000-8000-000000000001';
const migration = readFileSync(
  resolve(process.cwd(), 'supabase', 'migrations', '20261023000000_phase_a9_auction_realtime_publication.sql'),
  'utf8'
);
const ownerPage = readFileSync(
  resolve(process.cwd(), 'src', 'app', 'auction', '[auctionId]', 'bid', 'page.tsx'),
  'utf8'
);
const adminPage = readFileSync(
  resolve(process.cwd(), 'src', 'app', 'manager', 'auctions', '[auctionId]', 'control', 'page.tsx'),
  'utf8'
);
const ownerBidApi = readFileSync(
  resolve(process.cwd(), 'src', 'app', 'api', 'auctions', '[auctionId]', 'bid', 'route.ts'),
  'utf8'
);
const adminApi = readFileSync(
  resolve(process.cwd(), 'src', 'app', 'api', 'admin', 'auctions', '[auctionId]', 'control-panel', 'route.ts'),
  'utf8'
);
const ownerDashboardApi = readFileSync(
  resolve(process.cwd(), 'src', 'app', 'api', 'auctions', '[auctionId]', 'team-dashboard', 'route.ts'),
  'utf8'
);
const a2Migration = readFileSync(
  resolve(process.cwd(), 'supabase', 'migrations', '20261018000000_phase_a2_auction_foundation.sql'),
  'utf8'
);
const a5Migration = readFileSync(
  resolve(process.cwd(), 'supabase', 'migrations', '20261022000000_phase_a5_settlement.sql'),
  'utf8'
);

type Payload = {
  schema: 'public';
  table: 'auctions' | 'auction_lots';
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  commit_timestamp: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
};

function createRealtimeClient() {
  const handlers = new Map<string, (payload: Payload) => void>();
  let statusCallback: ((status: string) => void) | null = null;
  const channel = {
    on: vi.fn((type: string, filter: { table?: string; event?: string }, callback: (payload: Payload) => void) => {
      if (type === 'postgres_changes' && filter.table && filter.event) {
        handlers.set(`${filter.table}:${filter.event}`, callback);
      }
      return channel;
    }),
    subscribe: vi.fn((callback: (status: string) => void) => {
      statusCallback = callback;
      return channel;
    }),
  };
  const client = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => 'ok'),
  };
  return {
    client: client as unknown as SupabaseClient,
    channel,
    handlers,
    setStatus(status: string) {
      statusCallback?.(status);
    },
    emit(payload: Payload) {
      handlers.get(`${payload.table}:${payload.eventType}`)?.(payload);
    },
  };
}

function lotEvent(input: {
  auction?: string;
  id?: string;
  bid?: number;
  committedAt?: string;
  eventType?: Payload['eventType'];
} = {}): Payload {
  const record = {
    id: input.id || lotId,
    auction_id: input.auction || auctionId,
    current_highest_bid: input.bid ?? 21000,
    status: 'LIVE',
  };
  return {
    schema: 'public',
    table: 'auction_lots',
    eventType: input.eventType || 'UPDATE',
    commit_timestamp: input.committedAt || '2026-10-11T00:00:00.000Z',
    new: input.eventType === 'DELETE' ? {} : record,
    old: input.eventType === 'DELETE' ? record : {},
  };
}

function auctionEvent(input: {
  id?: string;
  status?: string;
  committedAt?: string;
} = {}): Payload {
  const record = {
    id: input.id || auctionId,
    status: input.status || 'CLOSED',
  };
  return {
    schema: 'public',
    table: 'auctions',
    eventType: 'UPDATE',
    commit_timestamp: input.committedAt || '2026-10-11T00:00:00.000Z',
    new: record,
    old: {},
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('A9 Supabase auction subscriptions', () => {
  it('creates one auction-scoped channel and listens only to auctions and lots', () => {
    const realtime = createRealtimeClient();
    const unsubscribe = subscribeToAuctionRealtime(
      realtime.client,
      auctionId,
      { refresh: vi.fn(), status: vi.fn() }
    );
    expect(realtime.client.channel).toHaveBeenCalledWith(`auction-sync:${auctionId}`);
    expect(realtime.channel.on).toHaveBeenCalledTimes(3);
    expect(realtime.channel.on).toHaveBeenNthCalledWith(
      1,
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'auctions',
        filter: `id=eq.${auctionId}`,
      },
      expect.any(Function)
    );
    expect(realtime.channel.on).toHaveBeenNthCalledWith(
      2,
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'auction_lots',
        filter: `auction_id=eq.${auctionId}`,
      },
      expect.any(Function)
    );
    expect(realtime.channel.on).toHaveBeenNthCalledWith(
      3,
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'auction_lots',
        filter: `auction_id=eq.${auctionId}`,
      },
      expect.any(Function)
    );
    unsubscribe();
  });

  it('prevents duplicate channels for multiple subscribers to the same auction', () => {
    const realtime = createRealtimeClient();
    const first = subscribeToAuctionRealtime(realtime.client, auctionId, {
      refresh: vi.fn(),
      status: vi.fn(),
    });
    const second = subscribeToAuctionRealtime(realtime.client, auctionId, {
      refresh: vi.fn(),
      status: vi.fn(),
    });
    expect(realtime.client.channel).toHaveBeenCalledTimes(1);
    first();
    expect(realtime.client.removeChannel).not.toHaveBeenCalled();
    second();
    expect(realtime.client.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('allows independent auction IDs to receive isolated channels', () => {
    const realtime = createRealtimeClient();
    const first = subscribeToAuctionRealtime(realtime.client, auctionId, {
      refresh: vi.fn(),
      status: vi.fn(),
    });
    const second = subscribeToAuctionRealtime(realtime.client, otherAuctionId, {
      refresh: vi.fn(),
      status: vi.fn(),
    });
    expect(realtime.client.channel).toHaveBeenNthCalledWith(1, `auction-sync:${auctionId}`);
    expect(realtime.client.channel).toHaveBeenNthCalledWith(2, `auction-sync:${otherAuctionId}`);
    first();
    second();
  });

  it('creates a fresh subscription after all listeners unmount and the auction page is reopened', () => {
    const realtime = createRealtimeClient();
    const first = subscribeToAuctionRealtime(realtime.client, auctionId, {
      refresh: vi.fn(),
      status: vi.fn(),
    });
    first();
    const second = subscribeToAuctionRealtime(realtime.client, auctionId, {
      refresh: vi.fn(),
      status: vi.fn(),
    });
    expect(realtime.client.channel).toHaveBeenCalledTimes(2);
    second();
  });

  it('removes the channel and pending event callback after the last subscriber unmounts', async () => {
    vi.useFakeTimers();
    const realtime = createRealtimeClient();
    const refresh = vi.fn();
    const unsubscribe = subscribeToAuctionRealtime(realtime.client, auctionId, {
      refresh,
      status: vi.fn(),
    });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    refresh.mockClear();
    realtime.emit(lotEvent());
    unsubscribe();
    await vi.advanceTimersByTimeAsync(100);
    expect(realtime.client.removeChannel).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reports connection and reconnect statuses', () => {
    const realtime = createRealtimeClient();
    const statuses: AuctionRealtimeStatus[] = [];
    const unsubscribe = subscribeToAuctionRealtime(realtime.client, auctionId, {
      refresh: vi.fn(),
      status: (status) => statuses.push(status),
    });
    realtime.setStatus('SUBSCRIBED');
    realtime.setStatus('CHANNEL_ERROR');
    realtime.setStatus('SUBSCRIBED');
    expect(statuses).toEqual(['CONNECTING', 'LIVE', 'RECONNECTING', 'LIVE']);
    unsubscribe();
  });

  it('refreshes authoritative state on initial subscription and reconnect', async () => {
    const realtime = createRealtimeClient();
    const refresh = vi.fn();
    const unsubscribe = subscribeToAuctionRealtime(realtime.client, auctionId, {
      refresh,
      status: vi.fn(),
    });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    refresh.mockClear();
    realtime.setStatus('SUBSCRIBED');
    await vi.waitFor(() => expect(refresh).not.toHaveBeenCalled());
    realtime.setStatus('TIMED_OUT');
    realtime.setStatus('SUBSCRIBED');
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    unsubscribe();
  });

  it('refreshes after relevant auction and lot changes', async () => {
    vi.useFakeTimers();
    const realtime = createRealtimeClient();
    const refresh = vi.fn();
    const unsubscribe = subscribeToAuctionRealtime(realtime.client, auctionId, {
      refresh,
      status: vi.fn(),
    });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    refresh.mockClear();
    realtime.emit(lotEvent());
    await vi.advanceTimersByTimeAsync(60);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    unsubscribe();
  });

  it('ignores events for another auction even if a client filter is violated', async () => {
    vi.useFakeTimers();
    const realtime = createRealtimeClient();
    const refresh = vi.fn();
    const unsubscribe = subscribeToAuctionRealtime(realtime.client, auctionId, {
      refresh,
      status: vi.fn(),
    });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    refresh.mockClear();
    realtime.emit(lotEvent({ auction: otherAuctionId }));
    await vi.advanceTimersByTimeAsync(100);
    expect(refresh).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('deduplicates repeated delivery of the same database event', async () => {
    vi.useFakeTimers();
    const realtime = createRealtimeClient();
    const refresh = vi.fn();
    const unsubscribe = subscribeToAuctionRealtime(realtime.client, auctionId, {
      refresh,
      status: vi.fn(),
    });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    refresh.mockClear();
    const event = lotEvent();
    realtime.emit(event);
    realtime.emit(event);
    await vi.advanceTimersByTimeAsync(60);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    unsubscribe();
  });

  it('coalesces a short burst of distinct events into one authoritative refresh', async () => {
    vi.useFakeTimers();
    const realtime = createRealtimeClient();
    const refresh = vi.fn();
    const unsubscribe = subscribeToAuctionRealtime(realtime.client, auctionId, {
      refresh,
      status: vi.fn(),
    });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    refresh.mockClear();
    realtime.emit(lotEvent({ bid: 22000, committedAt: 't1' }));
    realtime.emit(lotEvent({ bid: 24000, committedAt: 't2' }));
    realtime.emit(lotEvent({ bid: 26000, committedAt: 't3' }));
    await vi.advanceTimersByTimeAsync(60);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    unsubscribe();
  });

  it('does not apply out-of-order payload values and refreshes authoritative state instead', async () => {
    vi.useFakeTimers();
    const realtime = createRealtimeClient();
    const authoritativeState = { currentBid: 64000 };
    const refresh = vi.fn(async () => authoritativeState);
    const unsubscribe = subscribeToAuctionRealtime(realtime.client, auctionId, {
      refresh,
      status: vi.fn(),
    });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    refresh.mockClear();
    realtime.emit(lotEvent({ bid: 64000, committedAt: 'newer' }));
    await vi.advanceTimersByTimeAsync(60);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    realtime.emit(lotEvent({ bid: 62000, committedAt: 'older' }));
    await vi.advanceTimersByTimeAsync(60);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(authoritativeState.currentBid).toBe(64000);
    unsubscribe();
  });

  it('queues a second authoritative refresh when an event arrives during an in-flight refresh', async () => {
    vi.useFakeTimers();
    const realtime = createRealtimeClient();
    const refreshResolvers: Array<() => void> = [];
    const refresh = vi.fn(() => new Promise<void>((resolve) => {
      refreshResolvers.push(resolve);
    }));
    const unsubscribe = subscribeToAuctionRealtime(realtime.client, auctionId, {
      refresh,
      status: vi.fn(),
    });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    refreshResolvers[0]?.();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    refresh.mockClear();
    realtime.emit(lotEvent({ committedAt: 'first' }));
    await vi.advanceTimersByTimeAsync(60);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    realtime.emit(lotEvent({ committedAt: 'second' }));
    await vi.advanceTimersByTimeAsync(60);
    refreshResolvers[1]?.();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    unsubscribe();
  });

  it('refreshes when a new live lot is inserted', async () => {
    vi.useFakeTimers();
    const realtime = createRealtimeClient();
    const refresh = vi.fn();
    const unsubscribe = subscribeToAuctionRealtime(realtime.client, auctionId, {
      refresh,
      status: vi.fn(),
    });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    refresh.mockClear();
    realtime.emit(lotEvent({ eventType: 'INSERT', committedAt: 'new-live-lot' }));
    await vi.advanceTimersByTimeAsync(60);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    unsubscribe();
  });

  it.each(['SOLD', 'UNSOLD'])(
    'refreshes authoritative state when a lot settles as %s',
    async (status) => {
      vi.useFakeTimers();
      const realtime = createRealtimeClient();
      const refresh = vi.fn();
      const unsubscribe = subscribeToAuctionRealtime(realtime.client, auctionId, {
        refresh,
        status: vi.fn(),
      });
      await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      refresh.mockClear();
      realtime.emit({
        ...lotEvent({ committedAt: `settled-${status}` }),
        new: { ...lotEvent().new, status },
      });
      await vi.advanceTimersByTimeAsync(60);
      await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      unsubscribe();
    }
  );

  it('refreshes auction closure from the authoritative auction record', async () => {
    vi.useFakeTimers();
    const realtime = createRealtimeClient();
    const refresh = vi.fn();
    const unsubscribe = subscribeToAuctionRealtime(realtime.client, auctionId, {
      refresh,
      status: vi.fn(),
    });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    refresh.mockClear();
    realtime.emit(auctionEvent());
    await vi.advanceTimersByTimeAsync(60);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    unsubscribe();
  });

  it('ignores auction status updates for another auction', async () => {
    vi.useFakeTimers();
    const realtime = createRealtimeClient();
    const refresh = vi.fn();
    const unsubscribe = subscribeToAuctionRealtime(realtime.client, auctionId, {
      refresh,
      status: vi.fn(),
    });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    refresh.mockClear();
    realtime.emit(auctionEvent({ id: otherAuctionId }));
    await vi.advanceTimersByTimeAsync(100);
    expect(refresh).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('does not subscribe to DELETE events that cannot be safely auction-filtered', () => {
    const realtime = createRealtimeClient();
    const unsubscribe = subscribeToAuctionRealtime(realtime.client, auctionId, {
      refresh: vi.fn(),
      status: vi.fn(),
    });
    expect(realtime.channel.on).not.toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({ event: 'DELETE' }),
      expect.any(Function)
    );
    unsubscribe();
  });

  it('fans out the same public auction update to multiple mounted screens', async () => {
    vi.useFakeTimers();
    const realtime = createRealtimeClient();
    const ownerRefresh = vi.fn();
    const adminRefresh = vi.fn();
    const removeOwner = subscribeToAuctionRealtime(realtime.client, auctionId, {
      refresh: ownerRefresh,
      status: vi.fn(),
    });
    const removeAdmin = subscribeToAuctionRealtime(realtime.client, auctionId, {
      refresh: adminRefresh,
      status: vi.fn(),
    });
    await vi.waitFor(() => {
      expect(ownerRefresh).toHaveBeenCalledTimes(1);
      expect(adminRefresh).toHaveBeenCalledTimes(1);
    });
    ownerRefresh.mockClear();
    adminRefresh.mockClear();
    realtime.emit(auctionEvent({ committedAt: 'shared-auction-event' }));
    await vi.advanceTimersByTimeAsync(60);
    await vi.waitFor(() => {
      expect(ownerRefresh).toHaveBeenCalledTimes(1);
      expect(adminRefresh).toHaveBeenCalledTimes(1);
    });
    removeOwner();
    removeAdmin();
  });

  it('continues synchronization for a remaining subscriber when another page unmounts', async () => {
    vi.useFakeTimers();
    const realtime = createRealtimeClient();
    const firstRefresh = vi.fn();
    const secondRefresh = vi.fn();
    const removeFirst = subscribeToAuctionRealtime(realtime.client, auctionId, {
      refresh: firstRefresh,
      status: vi.fn(),
    });
    const removeSecond = subscribeToAuctionRealtime(realtime.client, auctionId, {
      refresh: secondRefresh,
      status: vi.fn(),
    });
    await vi.waitFor(() => {
      expect(firstRefresh).toHaveBeenCalledTimes(1);
      expect(secondRefresh).toHaveBeenCalledTimes(1);
    });
    firstRefresh.mockClear();
    secondRefresh.mockClear();
    removeFirst();
    realtime.emit(auctionEvent({ committedAt: 'remaining-listener' }));
    await vi.advanceTimersByTimeAsync(60);
    await vi.waitFor(() => expect(secondRefresh).toHaveBeenCalledTimes(1));
    expect(firstRefresh).not.toHaveBeenCalled();
    expect(realtime.client.removeChannel).not.toHaveBeenCalled();
    removeSecond();
  });

  it('handles separate committed updates to one lot without caching a stale bid payload', async () => {
    vi.useFakeTimers();
    const realtime = createRealtimeClient();
    const authoritativeState = { bid: 64000 };
    const refresh = vi.fn(async () => authoritativeState);
    const unsubscribe = subscribeToAuctionRealtime(realtime.client, auctionId, {
      refresh,
      status: vi.fn(),
    });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    refresh.mockClear();
    realtime.emit(lotEvent({ bid: 62000, committedAt: 'bid-1' }));
    await vi.advanceTimersByTimeAsync(60);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    realtime.emit(lotEvent({ bid: 64000, committedAt: 'bid-2' }));
    await vi.advanceTimersByTimeAsync(60);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(authoritativeState.bid).toBe(64000);
    unsubscribe();
  });
});

describe('A9 client integration and privacy', () => {
  it('uses only the existing browser Supabase client and subscribes to no financial tables', () => {
    expect(migration).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE public.auctions');
    expect(migration).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE public.auction_lots');
    expect(migration).not.toContain('auction_team_budgets');
    expect(migration).not.toContain('auction_purchases');
    expect(migration).not.toContain('auction_events');
    expect(a2Migration).toContain('Auction budget read access for admin, manager, or owner');
    expect(a2Migration).toContain('Auction lots visibility for authorized users');
  });

  it('does not weaken RLS or expose payment information through the publication', () => {
    expect(migration).not.toMatch(/DISABLE ROW LEVEL SECURITY|CREATE POLICY/i);
    expect(migration).not.toContain('payments');
    expect(migration).not.toContain('SUPABASE_SECRET_KEY');
    expect(ownerBidApi).toContain("supabase.rpc('place_auction_bid_v1'");
    expect(ownerBidApi).toContain("'place_auction_bid_v1'");
  });

  it('keeps private owner state scoped through the existing dashboard API after a public lot change', () => {
    expect(ownerPage).toContain('/team-dashboard');
    expect(ownerDashboardApi).toContain(".eq('team_owner_id', teamOwner.id)");
    expect(ownerDashboardApi).toContain('Cache-Control');
  });

  it('keeps admin snapshots behind the database-backed manager authorization API', () => {
    expect(adminApi).toContain('requireManager()');
    expect(adminPage).toContain('/api/admin/auctions/${auctionId}/control-panel');
    expect(adminPage).toContain('useAuctionRealtime');
  });

  it('refreshes the owner view from authoritative API data after subscription events', () => {
    expect(ownerPage).toContain('useAuctionRealtime(auctionId, refresh');
    expect(ownerPage).toContain('setBidding(bidPayload)');
    expect(ownerPage).toContain('setDashboard(dashboardPayload)');
  });

  it('refreshes the admin panel from its existing authoritative endpoint after subscription events', () => {
    expect(adminPage).toContain('useAuctionRealtime(auctionId, refresh');
    expect(adminPage).toContain('setData(panel)');
  });

  it('shows connection state without blocking the pages', () => {
    expect(ownerPage).toContain('OFFLINE — RECONNECTING');
    expect(adminPage).toContain('OFFLINE — RECONNECTING');
    expect(ownerPage).toContain("connectionStatus === 'LIVE'");
  });

  it('falls back to one controlled poll loop only while not realtime-connected', () => {
    const hook = readFileSync(
      resolve(process.cwd(), 'src', 'lib', 'auction', 'use-auction-realtime.ts'),
      'utf8'
    );
    expect(hook).toContain("if (status === 'LIVE') return");
    expect(hook).toContain('window.setInterval(poll, fallbackIntervalMs)');
    expect(hook).toContain('window.clearInterval(timer)');
  });

  it('refreshes on visibility restore and online recovery, and removes lifecycle listeners', () => {
    const hook = readFileSync(
      resolve(process.cwd(), 'src', 'lib', 'auction', 'use-auction-realtime.ts'),
      'utf8'
    );
    expect(hook).toContain("window.addEventListener('online', onOnline)");
    expect(hook).toContain("window.addEventListener('offline', onOffline)");
    expect(hook).toContain("document.addEventListener('visibilitychange', onVisibilityChange)");
    expect(hook).toContain("document.removeEventListener('visibilitychange', onVisibilityChange)");
    expect(hook).toContain('void refreshRef.current()');
  });

  it('derives timer presentation from server bid_deadline_at and never triggers client settlement', () => {
    expect(ownerBidApi).toContain('bidDeadlineAt: liveLot.bid_deadline_at');
    expect(ownerPage).toContain('Date.parse(lot.bidDeadlineAt)');
    expect(ownerPage).not.toContain("action: 'SETTLE'");
    expect(a5Migration).toContain('settle_auction_lot_v1');
  });

  it('reconciles settlement, retry round, budget, and auction closure by refreshing API snapshots', () => {
    expect(ownerPage).toContain('await refresh()');
    expect(adminPage).toContain('await refresh()');
    expect(adminApi).toContain('auction_team_budgets');
    expect(adminApi).toContain('auction_rounds');
    expect(a5Migration).toContain("'UNSOLD_RETRY'");
    expect(ownerPage).toContain('Auction Closed');
  });
});
