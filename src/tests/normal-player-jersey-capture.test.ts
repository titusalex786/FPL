import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as registerPlayerTournament } from '@/app/api/tournaments/[id]/register/route';
import { POST as registerPlayerWizard } from '@/app/api/registrations/route';
import { POST as registerOwner } from '@/app/api/registrations/owner/route';
import { POST as submitCorrection } from '@/app/api/registrations/[id]/correction/route';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/auth/is-admin', () => ({
  checkIsAdmin: vi.fn().mockResolvedValue({ isAdmin: false }),
}));

vi.mock('@/lib/storage/upload', () => ({
  uploadToStorageBucket: vi.fn().mockResolvedValue({
    publicUrl: 'https://storage.example.com/test-photo.jpg',
  }),
  validateImageFileBuffer: vi.fn().mockReturnValue({
    isValid: true,
    mimeType: 'image/jpeg',
    extension: 'jpg',
  }),
}));

function createFluentChain(defaultResult: any = { data: null, error: null }) {
  const chain: any = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.upsert = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.or = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(defaultResult);
  chain.maybeSingle = vi.fn().mockResolvedValue(defaultResult);
  return chain;
}

describe('Normal Player Jersey Name and Number End-to-End Verification', () => {
  const mockUser = { id: 'uat-user-auth-77', email: 'uat-player-77@fairplay.local' };
  const tournamentId = '11111111-2222-3333-4444-555555555555';
  const playerId = 'player-77-uuid';
  const registrationId = 'reg-77-uuid';

  let mockSupabaseServer: any;
  let mockSupabaseAdmin: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSupabaseServer = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'players') {
          const chain = createFluentChain({
            data: { id: playerId, auth_user_id: mockUser.id, full_name: 'Rahul Patil', email: mockUser.email },
            error: null,
          });
          return chain;
        }
        return createFluentChain();
      }),
    };
    (createServerSupabaseClient as any).mockResolvedValue(mockSupabaseServer);

    mockSupabaseAdmin = {
      from: vi.fn().mockImplementation(() => createFluentChain()),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    (createAdminClient as any).mockReturnValue(mockSupabaseAdmin);
  });

  it('1. Normal Player via tournament route captures jerseyName, jerseyNumber, and jerseySize in database snapshots', async () => {
    let capturedRegistrationPayload: any = null;
    let capturedPlayerPayload: any = null;

    mockSupabaseAdmin.from.mockImplementation((table: string) => {
      if (table === 'tournaments') {
        const chain = createFluentChain({
          data: {
            id: tournamentId,
            name: 'Test Tournament',
            registration_open: true,
            max_players: 50,
            registration_fee: 50000,
          },
          error: null,
        });
        return chain;
      }
      if (table === 'players') {
        const chain = createFluentChain();
        chain.upsert = vi.fn().mockImplementation((payload: any) => {
          capturedPlayerPayload = payload;
          const innerChain = createFluentChain({ data: { id: playerId, ...payload }, error: null });
          return innerChain;
        });
        return chain;
      }
      if (table === 'registrations') {
        const chain = createFluentChain();
        chain.select = vi.fn().mockImplementation((selStr: string, opts?: any) => {
          if (opts?.count === 'exact') {
            const countChain: any = {};
            countChain.eq = vi.fn().mockReturnValue(countChain);
            countChain.or = vi.fn().mockReturnValue(countChain);
            countChain.then = (resolve: any) => Promise.resolve({ count: 10, error: null }).then(resolve);
            return countChain;
          }
          return chain;
        });
        chain.insert = vi.fn().mockImplementation((payload: any) => {
          capturedRegistrationPayload = payload;
          const innerChain = createFluentChain({
            data: {
              id: registrationId,
              registration_number: 'REG-2026-UAT77',
              registration_status: 'CONFIRMED',
              ...payload,
            },
            error: null,
          });
          return innerChain;
        });
        return chain;
      }
      if (table === 'payments') {
        const chain = createFluentChain();
        chain.insert = vi.fn().mockResolvedValue({ data: null, error: null });
        return chain;
      }
      return createFluentChain();
    });

    const req = new NextRequest(`http://localhost:3000/api/tournaments/${tournamentId}/register`, {
      method: 'POST',
      body: JSON.stringify({
        targetType: 'SELF',
        fullName: 'Rahul Patil',
        email: mockUser.email,
        profileImageUrl: 'https://example.com/avatar.jpg',
        cricketRole: 'BATSMAN',
        battingStyle: 'RIGHT_HAND',
        jerseyName: 'UAT-PLAYER-77',
        jerseyNumber: '77',
        jerseySize: 'L',
        termsAccepted: true,
      }),
    });

    const res = await registerPlayerTournament(req, { params: Promise.resolve({ id: tournamentId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.registrationId).toBe(registrationId);

    // Verify player upsert received jersey details
    expect(capturedPlayerPayload).toBeDefined();
    expect(capturedPlayerPayload.jersey_name).toBe('UAT-PLAYER-77');
    expect(capturedPlayerPayload.jersey_number).toBe('77');
    expect(capturedPlayerPayload.jersey_size).toBe('L');

    // Verify registration row snapshot received jersey details
    expect(capturedRegistrationPayload).toBeDefined();
    expect(capturedRegistrationPayload.registered_jersey_name_snapshot).toBe('UAT-PLAYER-77');
    expect(capturedRegistrationPayload.registered_jersey_number_snapshot).toBe('77');
    expect(capturedRegistrationPayload.registered_jersey_size_snapshot).toBe('L');
  });

  it('2. Normal Player via wizard route calls allocate_player_registration_v2 with jersey parameters', async () => {
    mockSupabaseAdmin.rpc.mockResolvedValue({
      data: [{
        registration_id: registrationId,
        registration_number: 'REG-UAT7-0001',
        registration_status: 'PENDING',
        waitlist_position: null,
        payment_id: 'pay-123',
      }],
      error: null,
    });

    mockSupabaseAdmin.from.mockImplementation((table: string) => {
      if (table === 'players') {
        const chain = createFluentChain({
          data: { id: playerId, full_name: 'Rahul Patil' },
          error: null,
        });
        return chain;
      }
      if (table === 'tournaments') {
        const chain = createFluentChain({
          data: { id: tournamentId, registration_fee: 50000, registration_open: true },
          error: null,
        });
        return chain;
      }
      if (table === 'registrations') {
        return createFluentChain({ data: null, error: null });
      }
      return createFluentChain();
    });

    const req = new NextRequest('http://localhost:3000/api/registrations', {
      method: 'POST',
      body: JSON.stringify({
        tournamentId,
        registrationFor: 'SELF',
        fullName: 'Rahul Patil',
        email: mockUser.email,
        profilePhotoPath: 'https://example.com/photo.jpg',
        cricketRole: 'BATSMAN',
        primaryRole: 'BATSMAN',
        battingStyle: 'RIGHT_HAND',
        bowlingStyle: 'DOESNT_BOWL',
        jerseyName: 'UAT-PLAYER-77',
        jerseyNumber: '77',
        jerseySize: 'L',
        termsAccepted: true,
      }),
    });

    const res = await registerPlayerWizard(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.registrationId).toBe(registrationId);

    // Verify allocate_player_registration_v2 RPC called with jersey parameters
    expect(mockSupabaseAdmin.rpc).toHaveBeenCalledWith(
      'allocate_player_registration_v2',
      expect.objectContaining({
        p_registered_name_snapshot: 'Rahul Patil',
        p_registered_jersey_name_snapshot: 'UAT-PLAYER-77',
        p_registered_jersey_number_snapshot: '77',
        p_registered_jersey_size_snapshot: 'L',
      })
    );
  });

  it('3. Normal Player duplicate registration prevention', async () => {
    mockSupabaseAdmin.from.mockImplementation((table: string) => {
      if (table === 'tournaments') {
        return createFluentChain({
          data: { id: tournamentId, name: 'Tournament', registration_open: true, max_players: 50 },
          error: null,
        });
      }
      if (table === 'players') {
        return createFluentChain({
          data: { id: playerId, full_name: 'Rahul Patil' },
          error: null,
        });
      }
      if (table === 'registrations') {
        return createFluentChain({
          data: {
            id: 'existing-reg-id',
            registration_number: 'REG-2026-EXISTING',
            registration_status: 'CONFIRMED',
            status: 'CONFIRMED',
            waitlist_position: null,
          },
          error: null,
        });
      }
      return createFluentChain();
    });

    const req = new NextRequest(`http://localhost:3000/api/tournaments/${tournamentId}/register`, {
      method: 'POST',
      body: JSON.stringify({
        targetType: 'SELF',
        fullName: 'Rahul Patil',
        email: mockUser.email,
        profileImageUrl: 'https://example.com/avatar.jpg',
        cricketRole: 'BATSMAN',
        battingStyle: 'RIGHT_HAND',
        jerseyName: 'UAT-PLAYER-77',
        jerseyNumber: '77',
        jerseySize: 'L',
        termsAccepted: true,
      }),
    });

    const res = await registerPlayerTournament(req, { params: Promise.resolve({ id: tournamentId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.alreadyRegistered).toBe(true);
    expect(data.registrationId).toBe('existing-reg-id');
    expect(data.registrationNumber).toBe('REG-2026-EXISTING');
  });

  it('4. Owner & Icon registration continues to capture jersey details', async () => {
    mockSupabaseAdmin.rpc.mockResolvedValue({
      data: [{
        team_id: 'team-123',
        owner_registration_id: 'owner-reg-123',
        owner_registration_number: 'REG-OWN-0001',
        icon_registration_id: 'icon-reg-123',
        icon_registration_number: 'REG-ICN-0001',
        payment_id: 'pay-123',
        amount_paid: 2500000,
        registration_status: 'PENDING',
      }],
      error: null,
    });

    mockSupabaseAdmin.from.mockImplementation((table: string) => {
      if (table === 'tournaments') {
        return createFluentChain({
          data: { id: tournamentId, registration_fee: 50000 },
          error: null,
        });
      }
      if (table === 'players') {
        return createFluentChain({
          data: { id: 'owner-player-id', full_name: 'Vikram Merchant' },
          error: null,
        });
      }
      return createFluentChain();
    });

    const req = new NextRequest('http://localhost:3000/api/registrations/owner', {
      method: 'POST',
      body: JSON.stringify({
        tournamentId,
        ownerName: 'Vikram Merchant',
        contactEmail: 'owner@example.com',
        contactPhone: '9876543210',
        ownerRole: 'BATSMAN',
        ownerBattingStyle: 'RIGHT_HAND',
        ownerJerseySize: 'XL',
        ownerJerseyName: 'VIKRAM',
        ownerJerseyNumber: '10',
        ownerProfileImageUrl: 'https://example.com/owner.jpg',
        teamName: 'Mumbai Royals',
        iconPlayerName: 'Rohit Sharma',
        iconPlayerMobile: '9876543211',
        iconPlayerRole: 'BATSMAN',
        iconPlayerBattingStyle: 'RIGHT_HAND',
        iconJerseySize: 'L',
        iconJerseyName: 'ROHIT',
        iconJerseyNumber: '45',
        iconProfileImageUrl: 'https://example.com/icon.jpg',
        paymentMethod: 'UPI',
      }),
    });

    const res = await registerOwner(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ownerRegistrationId).toBe('owner-reg-123');

    // Verify allocate_owner_registration_v4 was called with both Owner and Icon jersey values
    expect(mockSupabaseAdmin.rpc).toHaveBeenCalledWith(
      'allocate_owner_registration_v4',
      expect.objectContaining({
        p_owner_jersey_name: 'VIKRAM',
        p_owner_jersey_number: '10',
        p_owner_jersey_size: 'XL',
        p_icon_jersey_name: 'ROHIT',
        p_icon_jersey_number: '45',
        p_icon_jersey_size: 'L',
      })
    );
  });

  it('5. Correction flow updates jersey name and number in registration snapshot', async () => {
    let capturedUpdatePayload: any = null;

    mockSupabaseAdmin.from.mockImplementation((table: string) => {
      if (table === 'registrations') {
        const chain = createFluentChain({
          data: {
            id: registrationId,
            tournament_id: tournamentId,
            player_id: playerId,
            registration_number: 'REG-2026-UAT77',
            registration_status: 'CORRECTION_REQUESTED',
            created_by_auth_id: mockUser.id,
            registered_name_snapshot: 'Rahul Patil',
            registered_jersey_name_snapshot: 'UAT-PLAYER-77',
            registered_jersey_number_snapshot: '77',
            registered_jersey_size_snapshot: 'L',
            registered_role_snapshot: 'BATSMAN',
            registered_batting_style_snapshot: 'RIGHT_HAND',
            registered_bowling_style_snapshot: 'DOESNT_BOWL',
            registered_image_snapshot: 'https://example.com/photo.jpg',
            correction_history: [
              {
                correction_id: 'corr-1',
                requested_at: '2026-10-06T10:00:00Z',
                requested_by: 'admin-1',
                requested_fields: ['Jersey Name', 'Jersey Number'],
                remark: 'Please update your jersey details',
              },
            ],
            player: { auth_user_id: mockUser.id },
            tournament: { registration_fee: 50000 },
          },
          error: null,
        });

        chain.update = vi.fn().mockImplementation((payload: any) => {
          capturedUpdatePayload = payload;
          return createFluentChain({ data: null, error: null });
        });

        return chain;
      }
      return createFluentChain();
    });

    const req = new NextRequest(`http://localhost:3000/api/registrations/${registrationId}/correction`, {
      method: 'POST',
      body: JSON.stringify({
        jersey_name: 'UAT-PLAYER-CHANGED',
        jersey_number: '99',
      }),
    });

    const res = await submitCorrection(req, { params: Promise.resolve({ id: registrationId }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);

    // Verify snapshot was updated to the new values
    expect(capturedUpdatePayload).toBeDefined();
    expect(capturedUpdatePayload.registered_jersey_name_snapshot).toBe('UAT-PLAYER-CHANGED');
    expect(capturedUpdatePayload.registered_jersey_number_snapshot).toBe('99');
    expect(capturedUpdatePayload.registration_status).toBe('PENDING');
  });

  it('6. Fallback defaults: when jerseyName is empty, it falls back to fullName; empty jerseyNumber falls back to null', async () => {
    let capturedRegistrationPayload: any = null;

    mockSupabaseAdmin.from.mockImplementation((table: string) => {
      if (table === 'tournaments') {
        return createFluentChain({
          data: { id: tournamentId, name: 'Tournament', registration_open: true, max_players: 50 },
          error: null,
        });
      }
      if (table === 'players') {
        return createFluentChain({
          data: { id: playerId, full_name: 'Rahul Patil' },
          error: null,
        });
      }
      if (table === 'registrations') {
        const chain = createFluentChain();
        chain.select = vi.fn().mockImplementation((selStr: string, opts?: any) => {
          if (opts?.count === 'exact') {
            const countChain: any = {};
            countChain.eq = vi.fn().mockReturnValue(countChain);
            countChain.or = vi.fn().mockReturnValue(countChain);
            countChain.then = (resolve: any) => Promise.resolve({ count: 5, error: null }).then(resolve);
            return countChain;
          }
          return chain;
        });
        chain.insert = vi.fn().mockImplementation((payload: any) => {
          capturedRegistrationPayload = payload;
          return createFluentChain({
            data: { id: registrationId, registration_number: 'REG-2026-0001', registration_status: 'CONFIRMED', ...payload },
            error: null,
          });
        });
        return chain;
      }
      return createFluentChain();
    });

    const req = new NextRequest(`http://localhost:3000/api/tournaments/${tournamentId}/register`, {
      method: 'POST',
      body: JSON.stringify({
        targetType: 'SELF',
        fullName: 'Rahul Patil',
        email: mockUser.email,
        profileImageUrl: 'https://example.com/avatar.jpg',
        cricketRole: 'BATSMAN',
        battingStyle: 'RIGHT_HAND',
        jerseySize: 'M',
        jerseyName: '', // empty -> should fallback to fullName
        jerseyNumber: '', // empty -> should fallback to null
        termsAccepted: true,
      }),
    });

    const res = await registerPlayerTournament(req, { params: Promise.resolve({ id: tournamentId }) });
    expect(res.status).toBe(200);

    expect(capturedRegistrationPayload.registered_jersey_name_snapshot).toBe('Rahul Patil');
    expect(capturedRegistrationPayload.registered_jersey_number_snapshot).toBeNull();
  });

  it('7. Registering for ANOTHER player captures the teammate jersey name/number and sets is_tournament_only flag', async () => {
    let capturedPlayerPayload: any = null;
    let capturedRegistrationPayload: any = null;

    mockSupabaseAdmin.from.mockImplementation((table: string) => {
      if (table === 'tournaments') {
        return createFluentChain({
          data: { id: tournamentId, name: 'Tournament', registration_open: true, max_players: 50 },
          error: null,
        });
      }
      if (table === 'players') {
        const chain = createFluentChain();
        chain.insert = vi.fn().mockImplementation((payload: any) => {
          capturedPlayerPayload = payload;
          return createFluentChain({
            data: { id: 'teammate-id', ...payload },
            error: null,
          });
        });
        return chain;
      }
      if (table === 'registrations') {
        const chain = createFluentChain();
        chain.select = vi.fn().mockImplementation((selStr: string, opts?: any) => {
          if (opts?.count === 'exact') {
            const countChain: any = {};
            countChain.eq = vi.fn().mockReturnValue(countChain);
            countChain.or = vi.fn().mockReturnValue(countChain);
            countChain.then = (resolve: any) => Promise.resolve({ count: 5, error: null }).then(resolve);
            return countChain;
          }
          return chain;
        });
        chain.insert = vi.fn().mockImplementation((payload: any) => {
          capturedRegistrationPayload = payload;
          return createFluentChain({
            data: { id: 'teammate-reg-id', ...payload },
            error: null,
          });
        });
        return chain;
      }
      return createFluentChain();
    });

    const req = new NextRequest(`http://localhost:3000/api/tournaments/${tournamentId}/register`, {
      method: 'POST',
      body: JSON.stringify({
        targetType: 'OTHER',
        fullName: 'Amit Kumar',
        email: 'amit.teammate@example.com',
        profileImageUrl: 'https://example.com/amit.jpg',
        cricketRole: 'BOWLER',
        battingStyle: 'RIGHT_HAND',
        jerseySize: 'XL',
        jerseyName: 'AMIT-K',
        jerseyNumber: '19',
        termsAccepted: true,
      }),
    });

    const res = await registerPlayerTournament(req, { params: Promise.resolve({ id: tournamentId }) });
    expect(res.status).toBe(200);

    // Verify teammate profile was created with tournament_only flag and correct jersey fields
    expect(capturedPlayerPayload.is_tournament_only).toBe(true);
    expect(capturedPlayerPayload.jersey_name).toBe('AMIT-K');
    expect(capturedPlayerPayload.jersey_number).toBe('19');

    // Verify registration row snapshot
    expect(capturedRegistrationPayload.registered_jersey_name_snapshot).toBe('AMIT-K');
    expect(capturedRegistrationPayload.registered_jersey_number_snapshot).toBe('19');
    expect(capturedRegistrationPayload.registered_jersey_size_snapshot).toBe('XL');
  });

  it('8. Source contract audit: Admin player registration views read registered_jersey_name_snapshot and registered_jersey_number_snapshot', () => {
    const fs = require('fs');
    const path = require('path');

    const adminTournamentFile = fs.readFileSync(
      path.join(process.cwd(), 'src/app/admin/tournament/[id]/page.tsx'),
      'utf8'
    );
    expect(adminTournamentFile).toContain('r.registered_jersey_name_snapshot');
    expect(adminTournamentFile).toContain('r.registered_jersey_number_snapshot');

    const adminPlayersFile = fs.readFileSync(
      path.join(process.cwd(), 'src/app/admin/players/page.tsx'),
      'utf8'
    );
    expect(adminPlayersFile).toContain('item.registered_jersey_name_snapshot');
    expect(adminPlayersFile).toContain('item.registered_jersey_number_snapshot');
  });

  it('9. Source contract audit: My Registration view reads registered_jersey_name_snapshot and registered_jersey_number_snapshot', () => {
    const fs = require('fs');
    const path = require('path');

    const myRegFile = fs.readFileSync(
      path.join(process.cwd(), 'src/app/registration/[id]/page.tsx'),
      'utf8'
    );
    expect(myRegFile).toContain('data.registration.registered_jersey_name_snapshot');
    expect(myRegFile).toContain('data.registration.registered_jersey_number_snapshot');
  });

  it('10. Source contract audit: Printable receipt view reads registered_jersey_name_snapshot and registered_jersey_number_snapshot', () => {
    const fs = require('fs');
    const path = require('path');

    const receiptFile = fs.readFileSync(
      path.join(process.cwd(), 'src/components/public/PrintableReceipt.tsx'),
      'utf8'
    );
    expect(receiptFile).toContain('registration.registered_jersey_name_snapshot');
    expect(receiptFile).toContain('registration.registered_jersey_number_snapshot');
  });

  it('11. Source contract audit: Tournament registration page contains jerseyName and jerseyNumber state, inputs and payload', () => {
    const fs = require('fs');
    const path = require('path');

    const tournamentPageFile = fs.readFileSync(
      path.join(process.cwd(), 'src/app/tournament/[id]/page.tsx'),
      'utf8'
    );
    expect(tournamentPageFile).toContain('const [jerseyName, setJerseyName] = useState(');
    expect(tournamentPageFile).toContain('const [jerseyNumber, setJerseyNumber] = useState(');
    expect(tournamentPageFile).toContain('id="field-jersey-name"');
    expect(tournamentPageFile).toContain('id="field-jersey-number"');
    expect(tournamentPageFile).toContain('jerseyName: effectiveJerseyName');
    expect(tournamentPageFile).toContain('jerseyNumber: jerseyNumber.trim()');
  });
});
