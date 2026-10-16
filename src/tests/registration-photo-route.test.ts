import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/registrations/[id]/photo/route';
import { createAdminClient } from '@/lib/supabase/admin';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

const registrationId = '20000000-0000-4000-8000-000000000001';

function setupClient(image: string | null) {
  const response = {
    data: {
      id: registrationId,
      registered_image_snapshot: image,
      player: null,
    },
    error: null,
  };
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq']) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle = vi.fn(() => Promise.resolve(response));

  const getPublicUrl = vi.fn((path: string) => ({
    data: { publicUrl: `https://storage.example/profile-images/${path}` },
  }));
  const storageFrom = vi.fn(() => ({ getPublicUrl }));
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn(() => query),
    storage: { from: storageFrom },
  } as never);

  return { getPublicUrl, storageFrom };
}

async function requestPhoto() {
  return GET(
    new NextRequest(`https://app.example/api/registrations/${registrationId}/photo`),
    { params: Promise.resolve({ id: registrationId }) }
  );
}

describe('registration photo route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects stored profile image object paths to the public Storage URL', async () => {
    const { getPublicUrl, storageFrom } = setupClient('players/atul/photo.jpg');

    const response = await requestPhoto();

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://storage.example/profile-images/players/atul/photo.jpg'
    );
    expect(storageFrom).toHaveBeenCalledWith('profile-images');
    expect(getPublicUrl).toHaveBeenCalledWith('players/atul/photo.jpg');
  });

  it('strips an explicit profile-images bucket prefix from stored paths', async () => {
    const { getPublicUrl } = setupClient('profile-images/players/atul/photo.jpg');

    await requestPhoto();

    expect(getPublicUrl).toHaveBeenCalledWith('players/atul/photo.jpg');
  });

  it('keeps legacy app-local image references working', async () => {
    const { storageFrom } = setupClient('/default-avatar.png');

    const response = await requestPhoto();

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://app.example/default-avatar.png');
    expect(storageFrom).not.toHaveBeenCalled();
  });
});
