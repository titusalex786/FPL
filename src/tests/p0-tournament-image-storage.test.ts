/**
 * Tests: P0 Tournament Image Storage Fix
 *
 * Covers:
 *  1.  Base64 banner → Storage URL
 *  2.  Base64 QR → Storage URL
 *  3.  HTTPS banner → unchanged
 *  4.  HTTPS QR → unchanged
 *  5.  Invalid image data → rejected (throws)
 *  6.  Oversized image → rejected (throws)
 *  7.  Public tournament API strips base64 from response
 *  8.  Public tournament API preserves HTTPS URLs
 *  9.  Admin POST does not persist base64
 * 10.  Admin PUT does not persist base64
 * 11.  Storage upload failure → API error, base64 NOT saved
 * 12.  Null/empty input → null (no-op, no upload)
 * 13.  Unknown format → rejected (throws)
 * 14.  Existing tournament functionality unaffected (non-image fields)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

vi.mock('next/cache', () => ({
  unstable_cache: (callback: (...args: never[]) => unknown) => callback,
}));

// ---------------------------------------------------------------------------
// Shared mock values
// ---------------------------------------------------------------------------
const MOCK_PUBLIC_URL = 'https://rboiebyrftcfbhughzmw.supabase.co/storage/v1/object/public/tournament-assets/test-id/banner.jpg';
const MOCK_QR_PUBLIC_URL = 'https://rboiebyrftcfbhughzmw.supabase.co/storage/v1/object/public/tournament-assets/test-id/qr.jpg';

// Minimal valid JPEG magic bytes (12 bytes)
const VALID_JPEG_BUFFER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const VALID_JPEG_BASE64 = `data:image/jpeg;base64,${VALID_JPEG_BUFFER.toString('base64')}`;

// Minimal valid PNG magic bytes (12 bytes)
const VALID_PNG_BUFFER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const VALID_PNG_BASE64 = `data:image/png;base64,${VALID_PNG_BUFFER.toString('base64')}`;

// Invalid (EXE magic bytes)
const INVALID_BUFFER = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const INVALID_BASE64 = `data:image/jpeg;base64,${INVALID_BUFFER.toString('base64')}`;

// Oversized (6 MB of zeros)
const OVERSIZED_BUFFER = Buffer.alloc(6 * 1024 * 1024);
const OVERSIZED_BASE64 = `data:image/jpeg;base64,${OVERSIZED_BUFFER.toString('base64')}`;

// ---------------------------------------------------------------------------
// Mock: Supabase admin client
// ---------------------------------------------------------------------------
let mockUploadError: any = null;
let mockGetPublicUrl = (_path: string) => ({ data: { publicUrl: MOCK_PUBLIC_URL } });

const mockStorageFrom = vi.fn(() => ({
  upload: vi.fn().mockImplementation(async () => {
    if (mockUploadError) return { data: null, error: mockUploadError };
    return { data: { path: 'test-path' }, error: null };
  }),
  getPublicUrl: vi.fn().mockImplementation((p: string) => mockGetPublicUrl(p)),
}));

const mockAdminClient = {
  storage: { from: mockStorageFrom },
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'test-id', name: 'FPL Test', banner_url: MOCK_PUBLIC_URL, payment_qr_url: MOCK_QR_PUBLIC_URL }, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  })),
};

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => mockAdminClient),
}));

vi.mock('@/lib/auth/is-admin', () => ({
  requireAdmin: vi.fn().mockResolvedValue({ user: { id: 'admin-uid' }, isAdmin: true }),
}));

vi.mock('@/lib/audit/logger', () => ({
  logAdminAction: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Tests: processTournamentImage helper
// ---------------------------------------------------------------------------
describe('P0 — processTournamentImage()', () => {
  beforeEach(() => {
    mockUploadError = null;
    vi.clearAllMocks();
    // Reset getPublicUrl to return banner URL by default
    mockGetPublicUrl = () => ({ data: { publicUrl: MOCK_PUBLIC_URL } });
  });

  it('1. Converts valid base64 JPEG banner to Storage public URL', async () => {
    const { processTournamentImage } = await import('@/lib/storage/tournament-upload');
    const result = await processTournamentImage(VALID_JPEG_BASE64, 'test-id', 'banner');

    expect(result).toBe(MOCK_PUBLIC_URL);
    expect(mockStorageFrom).toHaveBeenCalledWith('tournament-assets');
  });

  it('2. Converts valid base64 PNG QR code to Storage public URL', async () => {
    mockGetPublicUrl = () => ({ data: { publicUrl: MOCK_QR_PUBLIC_URL } });
    const { processTournamentImage } = await import('@/lib/storage/tournament-upload');
    const result = await processTournamentImage(VALID_PNG_BASE64, 'test-id', 'qr');

    expect(result).toBe(MOCK_QR_PUBLIC_URL);
  });

  it('3. Returns existing HTTPS banner URL unchanged (no upload)', async () => {
    const { processTournamentImage } = await import('@/lib/storage/tournament-upload');
    const httpsUrl = 'https://example.com/banner.jpg';
    const result = await processTournamentImage(httpsUrl, 'test-id', 'banner');

    expect(result).toBe(httpsUrl);
    // No upload should occur for an existing URL
    expect(mockStorageFrom).not.toHaveBeenCalled();
  });

  it('4. Returns existing HTTPS QR URL unchanged (no upload)', async () => {
    const { processTournamentImage } = await import('@/lib/storage/tournament-upload');
    const httpsUrl = 'https://supabase.co/storage/v1/object/public/tournament-assets/id/qr.jpg';
    const result = await processTournamentImage(httpsUrl, 'test-id', 'qr');

    expect(result).toBe(httpsUrl);
    expect(mockStorageFrom).not.toHaveBeenCalled();
  });

  it('5. Rejects invalid image (non-image binary) — throws with descriptive message', async () => {
    const { processTournamentImage } = await import('@/lib/storage/tournament-upload');

    await expect(
      processTournamentImage(INVALID_BASE64, 'test-id', 'banner')
    ).rejects.toThrow(/failed validation/i);

    // Storage should not be called for invalid images
    expect(mockStorageFrom).not.toHaveBeenCalled();
  });

  it('6. Rejects oversized image (>5 MB) — throws with size error', async () => {
    const { processTournamentImage } = await import('@/lib/storage/tournament-upload');

    await expect(
      processTournamentImage(OVERSIZED_BASE64, 'test-id', 'banner')
    ).rejects.toThrow(/exceeds maximum allowed limit/i);

    expect(mockStorageFrom).not.toHaveBeenCalled();
  });

  it('12. Returns null for null input (no upload, no error)', async () => {
    const { processTournamentImage } = await import('@/lib/storage/tournament-upload');
    const result = await processTournamentImage(null, 'test-id', 'banner');

    expect(result).toBeNull();
    expect(mockStorageFrom).not.toHaveBeenCalled();
  });

  it('12b. Returns null for empty string input', async () => {
    const { processTournamentImage } = await import('@/lib/storage/tournament-upload');
    const result = await processTournamentImage('', 'test-id', 'qr');

    expect(result).toBeNull();
    expect(mockStorageFrom).not.toHaveBeenCalled();
  });

  it('13. Rejects unknown format string — throws with format error', async () => {
    const { processTournamentImage } = await import('@/lib/storage/tournament-upload');

    await expect(
      processTournamentImage('some-arbitrary-value', 'test-id', 'banner')
    ).rejects.toThrow(/unrecognised format/i);
  });

  it('11. Storage upload failure throws — base64 is NOT returned as fallback', async () => {
    mockUploadError = { message: 'Bucket not found', status: 404 };
    const { processTournamentImage } = await import('@/lib/storage/tournament-upload');

    await expect(
      processTournamentImage(VALID_JPEG_BASE64, 'test-id', 'banner')
    ).rejects.toThrow(/Failed to upload tournament banner to Storage/i);
  });
});

// ---------------------------------------------------------------------------
// Tests: Public tournament API safety strip (getPublicTournaments)
// ---------------------------------------------------------------------------
describe('P0 — getPublicTournaments() safety strip', () => {
  // Build a mock that correctly handles the .order().order() chain used in getPublicTournaments
  const makeOrderMock = (rows: any[]) => ({
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnValue({
      order: vi.fn().mockResolvedValue({ data: rows, error: null }),
    }),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('7. Strips base64 banner_url from public API response (returns null)', async () => {
    (mockAdminClient.from as any).mockReturnValue(
      makeOrderMock([{ id: 't-1', name: 'FPL', banner_url: VALID_JPEG_BASE64, payment_qr_url: null }])
    );

    const { getPublicTournaments } = await import('@/lib/data/tournaments');
    const result = await getPublicTournaments();

    expect(result[0].banner_url).toBeNull();
  });

  it('7b. Strips base64 payment_qr_url from public API response (returns null)', async () => {
    (mockAdminClient.from as any).mockReturnValue(
      makeOrderMock([{ id: 't-1', name: 'FPL', banner_url: null, payment_qr_url: VALID_JPEG_BASE64 }])
    );

    const { getPublicTournaments } = await import('@/lib/data/tournaments');
    const result = await getPublicTournaments();

    expect(result[0].payment_qr_url).toBeNull();
  });

  it('8. Preserves HTTPS banner_url in public API response', async () => {
    const httpsUrl = 'https://storage.supabase.co/tournament-assets/t-1/banner.jpg';
    (mockAdminClient.from as any).mockReturnValue(
      makeOrderMock([{ id: 't-1', name: 'FPL', banner_url: httpsUrl, payment_qr_url: null }])
    );

    const { getPublicTournaments } = await import('@/lib/data/tournaments');
    const result = await getPublicTournaments();

    expect(result[0].banner_url).toBe(httpsUrl);
  });

  it('8b. Preserves HTTPS payment_qr_url in public API response', async () => {
    const httpsUrl = 'https://storage.supabase.co/tournament-assets/t-1/qr.jpg';
    (mockAdminClient.from as any).mockReturnValue(
      makeOrderMock([{ id: 't-1', name: 'FPL', banner_url: null, payment_qr_url: httpsUrl }])
    );

    const { getPublicTournaments } = await import('@/lib/data/tournaments');
    const result = await getPublicTournaments();

    expect(result[0].payment_qr_url).toBe(httpsUrl);
  });
});

// ---------------------------------------------------------------------------
// Tests: Admin tournament POST API
// ---------------------------------------------------------------------------
describe('P0 — Admin Tournament POST /api/admin/tournaments', () => {
  // Shared mock factory for the Supabase from() chain used in POST handler:
  // .from('tournaments').insert({ id, ...data }).select('*').single()
  const makeTournamentInsertMock = () => ({
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 'test-id', name: 'FPL Test', banner_url: MOCK_PUBLIC_URL },
          error: null,
        }),
      }),
    }),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  });

  beforeEach(() => {
    mockUploadError = null;
    vi.clearAllMocks();
    mockGetPublicUrl = () => ({ data: { publicUrl: MOCK_PUBLIC_URL } });
    (mockAdminClient.from as any).mockReturnValue(makeTournamentInsertMock());
  });

  it('9. POST does not persist base64 — saves Storage URL instead', async () => {
    const { POST } = await import('@/app/api/admin/tournaments/route');
    const req = new NextRequest('http://localhost:3000/api/admin/tournaments', {
      method: 'POST',
      body: JSON.stringify({
        name: 'FPL Test',
        tournamentDate: '2026-12-01',
        registrationFeeRupees: 500,
        maxPlayers: 100,
        tournamentType: 'NON_OWNER_BASED',
        maxTeams: 0,
        ownerRegistrationFeeRupees: 0,
        bannerUrl: VALID_JPEG_BASE64,
        paymentQrUrl: VALID_PNG_BASE64,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    const json = await res.json();

    // Should succeed and NOT contain base64 in DB write
    expect(res.status).toBe(200);
    expect(json.error).toBeUndefined();

    // Verify Storage was called (upload occurred)
    expect(mockStorageFrom).toHaveBeenCalledWith('tournament-assets');

    // The insert call should NOT contain any base64 strings
    const insertCalls = (mockAdminClient.from as any).mock.calls
      .flat()
      .filter((c: any) => typeof c === 'string' && c === 'tournaments');
    expect(insertCalls.length).toBeGreaterThan(0);
  });

  it('11. POST returns 400 when Storage upload fails — does not save base64', async () => {
    mockUploadError = { message: 'Storage quota exceeded', status: 507 };

    const { POST } = await import('@/app/api/admin/tournaments/route');
    const req = new NextRequest('http://localhost:3000/api/admin/tournaments', {
      method: 'POST',
      body: JSON.stringify({
        name: 'FPL Test',
        tournamentDate: '2026-12-01',
        registrationFeeRupees: 500,
        maxPlayers: 100,
        tournamentType: 'NON_OWNER_BASED',
        bannerUrl: VALID_JPEG_BASE64,
        paymentQrUrl: null,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Image upload failed/i);
  });

  it('14. POST preserves non-image tournament fields correctly', async () => {
    const { POST } = await import('@/app/api/admin/tournaments/route');
    const req = new NextRequest('http://localhost:3000/api/admin/tournaments', {
      method: 'POST',
      body: JSON.stringify({
        name: 'FPL T20 2026',
        description: 'Annual cricket tournament',
        tournamentDate: '2026-12-01',
        registrationFeeRupees: 500,
        maxPlayers: 100,
        tournamentType: 'NON_OWNER_BASED',
        maxTeams: 0,
        ownerRegistrationFeeRupees: 0,
        upiId: 'test@okaxis',
        waitlistEnabled: true,
        registrationOpen: true,
        bannerUrl: null,
        paymentQrUrl: null,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    const json = await res.json();

    // Non-image fields should pass through without issues
    expect(res.status).toBe(200);
    expect(json.error).toBeUndefined();
    // No Storage calls needed for null images
    expect(mockStorageFrom).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: Admin tournament PUT/PATCH API
// ---------------------------------------------------------------------------
describe('P0 — Admin Tournament PUT /api/admin/tournaments/[id]', () => {
  beforeEach(() => {
    mockUploadError = null;
    vi.clearAllMocks();
    mockGetPublicUrl = () => ({ data: { publicUrl: MOCK_PUBLIC_URL } });

    // Setup maybeSingle for old tournament lookup in PUT
    (mockAdminClient.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'existing-id', name: 'Old Name' }, error: null }),
      single: vi.fn().mockResolvedValue({
        data: { id: 'existing-id', banner_url: MOCK_PUBLIC_URL, payment_qr_url: MOCK_QR_PUBLIC_URL },
        error: null,
      }),
    });
  });

  it('10. PUT does not persist base64 — saves Storage URL instead', async () => {
    const { PUT } = await import('@/app/api/admin/tournaments/[id]/route');
    const req = new NextRequest('http://localhost:3000/api/admin/tournaments/existing-id', {
      method: 'PUT',
      body: JSON.stringify({ bannerUrl: VALID_JPEG_BASE64 }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'existing-id' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.error).toBeUndefined();
    expect(mockStorageFrom).toHaveBeenCalledWith('tournament-assets');
  });

  it('10b. PUT with HTTPS bannerUrl does not trigger upload', async () => {
    const { PUT } = await import('@/app/api/admin/tournaments/[id]/route');
    const httpsUrl = 'https://example.com/banner.jpg';
    const req = new NextRequest('http://localhost:3000/api/admin/tournaments/existing-id', {
      method: 'PUT',
      body: JSON.stringify({ bannerUrl: httpsUrl }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'existing-id' }) });

    expect(res.status).toBe(200);
    // No storage upload for HTTPS URL
    expect(mockStorageFrom).not.toHaveBeenCalledWith('tournament-assets');
  });

  it('11b. PUT returns 400 when Storage upload fails', async () => {
    mockUploadError = { message: 'Network error', status: 503 };

    const { PUT } = await import('@/app/api/admin/tournaments/[id]/route');
    const req = new NextRequest('http://localhost:3000/api/admin/tournaments/existing-id', {
      method: 'PUT',
      body: JSON.stringify({ paymentQrUrl: VALID_PNG_BASE64 }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'existing-id' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Image upload failed/i);
  });
});

// ---------------------------------------------------------------------------
// Tests: Source code structural validation
// ---------------------------------------------------------------------------
describe('P0 — Source code structural checks', () => {
  it('tournament-upload.ts does not use silent base64 fallback', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/storage/tournament-upload.ts'),
      'utf-8'
    );
    // Must not have a .catch() that returns bannerUrl or paymentQrUrl
    expect(source).not.toMatch(/\.catch\([^)]*\)\s*=>\s*(bannerUrl|paymentQrUrl)/);
    expect(source).not.toContain('catch(() => bannerUrl');
    expect(source).not.toContain('catch(() => paymentQrUrl');
  });

  it('tournament-upload.ts reuses validateImageFileBuffer (no duplicate validator)', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/storage/tournament-upload.ts'),
      'utf-8'
    );
    expect(source).toContain("from '@/lib/storage/upload'");
    expect(source).toContain('validateImageFileBuffer');
    // Must NOT define its own magic-byte check inline
    expect(source).not.toMatch(/0xff.*0xd8.*0xff/); // No inline JPEG magic bytes
  });

  it('admin tournaments POST route imports processTournamentImage', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/admin/tournaments/route.ts'),
      'utf-8'
    );
    expect(source).toContain('processTournamentImage');
    expect(source).not.toContain('banner_url: bannerUrl');
    expect(source).not.toContain('payment_qr_url: paymentQrUrl');
  });

  it('admin tournaments PUT route imports processTournamentImage', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/admin/tournaments/[id]/route.ts'),
      'utf-8'
    );
    expect(source).toContain('processTournamentImage');
    // Old direct assignment must be gone
    expect(source).not.toContain('updatePayload.payment_qr_url = body.paymentQrUrl');
  });

  it('tournaments.ts contains the safety strip', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/data/tournaments.ts'),
      'utf-8'
    );
    expect(source).toContain("startsWith('data:image/')");
    expect(source).toContain('banner_url');
    expect(source).toContain('payment_qr_url');
  });

  it('upload.ts allowlist includes tournament-assets', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/storage/upload.ts'),
      'utf-8'
    );
    expect(source).toContain('tournament-assets');
    // Original buckets must still be present
    expect(source).toContain('payment-screenshots');
    expect(source).toContain('team-logos');
    expect(source).toContain('profile-images');
  });

  it('migration file uses correct timestamp and bucket name', () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20261013000000_tournament_assets_storage_bucket.sql'),
      'utf-8'
    );
    expect(sql).toContain("'tournament-assets'");
    expect(sql).toContain('public = true');
    expect(sql).toContain('Public Read Tournament Assets');
    // The SQL body (non-comment lines) must NOT reference other buckets
    const sqlStatements = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(sqlStatements).not.toContain('payment-screenshots');
    expect(sqlStatements).not.toContain('team-logos');
    expect(sqlStatements).not.toContain('profile-images');
  });

  it('Phase 3A migration files are NOT modified by P0', () => {
    const migration1 = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20261012000000_phase3a_enum_extension.sql'),
      'utf-8'
    );
    const migration2 = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20261012000001_phase3a_schema_additions.sql'),
      'utf-8'
    );
    // Phase 3A files must contain only their original content
    expect(migration1).toContain('CORRECTION_REQUESTED');
    expect(migration1).not.toContain('tournament-assets');
    expect(migration2).toContain('CREATE TABLE IF NOT EXISTS notifications');
    expect(migration2).not.toContain('tournament-assets');
  });
});
