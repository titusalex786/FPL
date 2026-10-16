import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

type RouteContext = {
  params: Promise<{ id: string }>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 1x1 transparent PNG fallback for missing photos
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  if (!UUID_PATTERN.test(id)) {
    return new NextResponse('Invalid ID', { status: 400 });
  }

  try {
    const supabase = createAdminClient();

    const { data: reg, error } = await supabase
      .from('registrations')
      .select('id, registered_image_snapshot, player:players(profile_image_url)')
      .eq('id', id)
      .maybeSingle();

    if (error || !reg) {
      return new NextResponse(TRANSPARENT_PNG, {
        status: 404,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=300',
        },
      });
    }

    const imageRaw: string | null =
      reg.registered_image_snapshot ||
      (reg.player as any)?.profile_image_url ||
      null;

    if (!imageRaw) {
      return new NextResponse(TRANSPARENT_PNG, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    // If it's an external HTTP/HTTPS URL, redirect with long cache
    if (imageRaw.startsWith('http://') || imageRaw.startsWith('https://')) {
      return NextResponse.redirect(imageRaw, {
        status: 307,
        headers: {
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        },
      });
    }

    // If it's a data URI (data:image/jpeg;base64,...), decode and stream as raw binary
    if (imageRaw.startsWith('data:image/')) {
      const match = imageRaw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (match) {
        const mimeType = match[1];
        const base64Data = match[2];
        const buffer = Buffer.from(base64Data, 'base64');

        return new NextResponse(buffer, {
          status: 200,
          headers: {
            'Content-Type': mimeType,
            'Content-Length': String(buffer.length),
            'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
          },
        });
      }
    }

    // Preserve legacy references to public assets served by the app itself.
    if (imageRaw.startsWith('/') && !imageRaw.startsWith('//')) {
      return NextResponse.redirect(new URL(imageRaw, _req.url), {
        status: 307,
        headers: {
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        },
      });
    }

    // Newer registrations may store the Storage object path instead of its public URL.
    const objectPath = imageRaw.replace(/^profile-images\//, '');
    if (objectPath && !objectPath.split('/').some((segment) => segment === '.' || segment === '..')) {
      const { data: publicData } = supabase.storage
        .from('profile-images')
        .getPublicUrl(objectPath);

      if (publicData.publicUrl) {
        return NextResponse.redirect(publicData.publicUrl, {
          status: 307,
          headers: {
            'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
          },
        });
      }
    }

    // Fallback: return transparent PNG
    return new NextResponse(TRANSPARENT_PNG, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Error serving player photo:', error);
    return new NextResponse(TRANSPARENT_PNG, {
      status: 500,
      headers: {
        'Content-Type': 'image/png',
      },
    });
  }
}
