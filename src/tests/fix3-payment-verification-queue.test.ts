import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/admin/tournament/[id]/summary/route';
import { createAdminClient } from '@/lib/supabase/admin';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/auth/is-manager', () => ({
  requireManager: vi.fn().mockResolvedValue({
    user: { id: 'admin1' },
    role: 'ADMIN',
    isAdmin: true,
  }),
}));

describe('Fix 3: Payment Verification Queue Filtering', () => {
  it('should correctly filter pendingApprovals based on payment_status and registration_status', async () => {
    // Setup Mock Data
    const mockRegistrations = [
      { id: 'r1', registration_status: 'PENDING', payment: { id: 'p1', payment_status: 'PENDING' } },
      { id: 'r2', registration_status: 'CONFIRMED', payment: { id: 'p2', payment_status: 'SUCCESSFUL' } },
      { id: 'r3', registration_status: 'CANCELLED', payment: { id: 'p3', payment_status: 'CANCELLED' } },
      { id: 'r4', registration_status: 'REJECTED', payment: { id: 'p4', payment_status: 'REJECTED' } },
      { id: 'r5', registration_status: 'PENDING', payment: { id: 'p5', payment_status: 'SUCCESSFUL' } },
      { id: 'r6', registration_status: 'PENDING', payment: { id: 'p6', payment_status: 'VERIFICATION_REQUIRED' } },
      { id: 'r7', registration_status: 'PENDING', payment: { id: 'p7', payment_status: 'AWAITING_ORGANISER_ACKNOWLEDGEMENT' } },
      { id: 'r8', registration_status: 'PENDING', payment: { id: 'p1', payment_status: 'PENDING' } }, // duplicate payment ID
    ];

    const mockPayments = mockRegistrations.map(r => ({ ...r.payment, registration_id: r.id }));
    const mockTournament = { id: 't1', name: 'Test', max_players: 10, max_teams: 8 };

    const mockSupabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin1', user_metadata: { role: 'ADMIN' } } }, error: null }) },
      from: vi.fn().mockImplementation((table) => {
        const createChain = (data: any) => {
          const promise = Promise.resolve({ data, error: null });
          const chain = {
            select: vi.fn().mockReturnValue(promise),
            eq: vi.fn().mockReturnValue(promise),
            in: vi.fn().mockReturnValue(promise),
            order: vi.fn().mockReturnValue(promise),
            single: vi.fn().mockReturnValue(promise),
            then: promise.then.bind(promise),
            catch: promise.catch.bind(promise),
            finally: promise.finally.bind(promise),
          };
          // Make chain methods return the chain itself to support chaining
          chain.select.mockReturnValue(chain);
          chain.eq.mockReturnValue(chain);
          chain.in.mockReturnValue(chain);
          chain.order.mockReturnValue(chain);
          chain.single.mockReturnValue(chain);
          return chain;
        };

        if (table === 'tournaments') return createChain(mockTournament);
        if (table === 'registrations') return createChain(mockRegistrations);
        if (table === 'payments') return createChain(mockPayments);
        return createChain([]);
      })
    };

    (createAdminClient as any).mockReturnValue(mockSupabase);

    const req = new NextRequest('http://localhost/api/admin/tournament/t1/summary');
    const params = Promise.resolve({ id: 't1' });
    const res = await GET(req, { params });
    const data = await res.json();
    console.log("Returned Data:", data);

    // 1. PENDING appears
    expect(data.pendingApprovals.some((r: any) => r.id === 'r1')).toBe(true);
    // 2. SUCCESSFUL does NOT appear
    expect(data.pendingApprovals.some((r: any) => r.id === 'r2')).toBe(false);
    // 3. CANCELLED does NOT appear
    expect(data.pendingApprovals.some((r: any) => r.id === 'r3')).toBe(false);
    // 4. REJECTED does NOT appear
    expect(data.pendingApprovals.some((r: any) => r.id === 'r4')).toBe(false);
    // 5. Payment SUCCESSFUL but Registration PENDING does NOT appear
    expect(data.pendingApprovals.some((r: any) => r.id === 'r5')).toBe(false);
    // 6. VERIFICATION_REQUIRED appears
    expect(data.pendingApprovals.some((r: any) => r.id === 'r6')).toBe(true);
    // 7. AWAITING_ORGANISER_ACKNOWLEDGEMENT appears
    expect(data.pendingApprovals.some((r: any) => r.id === 'r7')).toBe(true);
    // 8. Deduplication by payment.id prevents duplicate payments in queue
    expect(data.pendingApprovals.filter((r: any) => r.payment?.id === 'p1').length).toBe(1);
    
    // 9. Counter matches deduplicated list length
    expect(data.stats.pendingPayments).toBe(data.pendingApprovals.length);
  });
});
