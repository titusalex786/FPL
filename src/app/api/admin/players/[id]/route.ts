import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAdminAction } from '@/lib/audit/logger';
import { getAdminPlayerDetails } from '@/lib/admin/player-details';
import {
  adminEditPlayerProfileSchema,
  PROTECTED_FIELDS,
} from '@/lib/validation/admin-player-edit';
import { uploadToStorageBucket, validateImageFileBuffer } from '@/lib/storage/upload';

export const dynamic = 'force-dynamic';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_FIELDS = [
  'fullName',
  'full_name',
  'mobile',
  'profileImageUrl',
  'profile_image_url',
  'cricketRole',
  'cricket_role',
  'battingStyle',
  'batting_style',
  'bowlingStyle',
  'bowling_style',
  'jerseyName',
  'jersey_name',
  'jerseyNumber',
  'jersey_number',
  'jerseySize',
  'jersey_size',
  'editReason',
  'edit_reason',
  'reason',
];

async function verifyAdminAuth() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { authorized: false, status: 401, error: 'Authentication required', user: null };
  }

  const adminClient = createAdminClient();
  const { data: adminEntry } = await adminClient
    .from('admin_users')
    .select('id, role, status')
    .eq('id', user.id)
    .eq('status', 'ACTIVE')
    .maybeSingle();

  if (!adminEntry) {
    return { authorized: false, status: 403, error: 'Admin access required', user: null };
  }

  return { authorized: true, status: 200, error: null, user };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyAdminAuth();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id } = await params;
    if (!id || !UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid Player or Registration ID' }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const preferredRegistrationId = searchParams.get('registrationId');

    const details = await getAdminPlayerDetails(id, preferredRegistrationId);
    if (!details) {
      return NextResponse.json({ error: 'Player or registration not found' }, { status: 404 });
    }

    return NextResponse.json(details);
  } catch (err: any) {
    console.error('Error in GET /api/admin/players/[id]:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyAdminAuth();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id: playerId } = await params;
    if (!playerId || !UUID_REGEX.test(playerId)) {
      return NextResponse.json({ error: 'Invalid Player ID format' }, { status: 400 });
    }

    let rawBody: any;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    if (!rawBody || typeof rawBody !== 'object') {
      return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 });
    }

    // 1. Strictly reject attempts to modify protected fields
    for (const key of Object.keys(rawBody)) {
      if ((PROTECTED_FIELDS as readonly string[]).includes(key)) {
        return NextResponse.json(
          { error: `Field '${key}' is protected and cannot be modified.` },
          { status: 400 }
        );
      }
    }

    // 2. Reject unrecognized fields
    for (const key of Object.keys(rawBody)) {
      if (!ALLOWED_FIELDS.includes(key)) {
        return NextResponse.json(
          { error: `Field '${key}' is unrecognized or not allowed.` },
          { status: 400 }
        );
      }
    }

    // 3. Validate mandatory edit reason
    const editReason = (rawBody.editReason || rawBody.edit_reason || rawBody.reason || '').trim();
    if (!editReason || editReason.length < 5) {
      return NextResponse.json(
        { error: 'A mandatory edit reason of at least 5 characters is required.' },
        { status: 400 }
      );
    }

    // 4. Validate payload with Zod schema
    const validationResult = adminEditPlayerProfileSchema.safeParse(rawBody);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validationResult.error.flatten() },
        { status: 400 }
      );
    }

    const parsed = validationResult.data;
    const supabaseAdmin = createAdminClient();

    // 5. Fetch existing player profile from `players` table
    const { data: existingPlayer, error: fetchErr } = await supabaseAdmin
      .from('players')
      .select('*')
      .eq('id', playerId)
      .maybeSingle();

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    if (!existingPlayer) {
      return NextResponse.json({ error: 'Player profile not found' }, { status: 404 });
    }

    // 6. Handle Profile Image (Base64 upload vs Storage URL)
    let effectiveProfileImageUrl: string | null | undefined = undefined;
    let newUploadedObjectPath: string | null = null;

    const requestedImage =
      parsed.profileImageUrl !== undefined
        ? parsed.profileImageUrl
        : parsed.profile_image_url !== undefined
        ? parsed.profile_image_url
        : undefined;

    if (requestedImage !== undefined) {
      if (requestedImage && requestedImage.includes('payment-screenshots')) {
        return NextResponse.json(
          { error: 'Cannot access payment screenshots as profile image.' },
          { status: 400 }
        );
      }

      if (
        requestedImage &&
        (requestedImage.startsWith('http://') || requestedImage.startsWith('https://'))
      ) {
        const isExistingUrl = requestedImage === existingPlayer.profile_image_url;
        const isSupabaseStorage =
          Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
          requestedImage.includes(process.env.NEXT_PUBLIC_SUPABASE_URL || '');
        if (!isExistingUrl && !isSupabaseStorage) {
          return NextResponse.json(
            { error: 'Arbitrary external profile image URLs are not allowed. Please upload an image file (JPEG, PNG, WebP).' },
            { status: 400 }
          );
        }
      }

      if (requestedImage && requestedImage.startsWith('data:image/')) {
        const cleanBase64 = requestedImage.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');
        const validation = validateImageFileBuffer(buffer);

        if (!validation.isValid || !validation.mimeType) {
          return NextResponse.json(
            { error: validation.error || 'Invalid profile image format (JPEG, PNG, WebP allowed, <= 5MB)' },
            { status: 400 }
          );
        }

        const ext = validation.mimeType === 'image/jpeg' ? 'jpg' : validation.mimeType === 'image/webp' ? 'webp' : 'png';
        const objectPath = `${playerId}/${Date.now()}_admin_edit.${ext}`;
        try {
          const uploadResult = await uploadToStorageBucket('profile-images', objectPath, buffer, validation.mimeType);
          effectiveProfileImageUrl = uploadResult.publicUrl || objectPath;
          newUploadedObjectPath = objectPath;
        } catch (uploadErr: any) {
          return NextResponse.json({ error: uploadErr.message || 'Failed to upload profile image' }, { status: 400 });
        }
      } else {
        effectiveProfileImageUrl = requestedImage;
      }
    }

    // 7. Construct updates payload for atomic RPC
    const updates: Record<string, any> = {};

    if (parsed.fullName !== undefined) {
      updates.full_name = parsed.fullName.trim();
    } else if (parsed.full_name !== undefined) {
      updates.full_name = parsed.full_name.trim();
    }

    if (parsed.mobile !== undefined) {
      updates.mobile = parsed.mobile ? parsed.mobile.replace(/\s+|-|\+91/g, '').trim() : null;
    }

    if (effectiveProfileImageUrl !== undefined) {
      updates.profile_image_url = effectiveProfileImageUrl;
    }

    if (parsed.cricketRole !== undefined) {
      updates.cricket_role = parsed.cricketRole;
    } else if (parsed.cricket_role !== undefined) {
      updates.cricket_role = parsed.cricket_role;
    }

    if (parsed.battingStyle !== undefined) {
      updates.batting_style = parsed.battingStyle || null;
    } else if (parsed.batting_style !== undefined) {
      updates.batting_style = parsed.batting_style || null;
    }

    if (parsed.bowlingStyle !== undefined) {
      updates.bowling_style = parsed.bowlingStyle ? parsed.bowlingStyle.trim() : null;
    } else if (parsed.bowling_style !== undefined) {
      updates.bowling_style = parsed.bowling_style ? parsed.bowling_style.trim() : null;
    }

    if (parsed.jerseyName !== undefined) {
      updates.jersey_name = parsed.jerseyName ? parsed.jerseyName.trim() : null;
    } else if (parsed.jersey_name !== undefined) {
      updates.jersey_name = parsed.jersey_name ? parsed.jersey_name.trim() : null;
    }

    if (parsed.jerseyNumber !== undefined) {
      updates.jersey_number = parsed.jerseyNumber ? parsed.jerseyNumber.trim() : null;
    } else if (parsed.jersey_number !== undefined) {
      updates.jersey_number = parsed.jersey_number ? parsed.jersey_number.trim() : null;
    }

    if (parsed.jerseySize !== undefined) {
      updates.jersey_size = parsed.jerseySize || null;
    } else if (parsed.jersey_size !== undefined) {
      updates.jersey_size = parsed.jersey_size || null;
    }

    // 8. Call atomic PostgreSQL RPC: admin_update_player_profile_v1
    const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc(
      'admin_update_player_profile_v1',
      {
        p_player_id: playerId,
        p_admin_user_id: auth.user!.id,
        p_admin_email: auth.user!.email || 'admin@fairplaypremierleague.com',
        p_reason: editReason,
        p_updates: updates,
      }
    );

    if (rpcErr) {
      // Step 5: Clean up newly uploaded image object if database transaction failed
      if (newUploadedObjectPath) {
        try {
          await supabaseAdmin.storage.from('profile-images').remove([newUploadedObjectPath]);
        } catch (cleanErr) {
          console.error('Failed to cleanup uploaded image after RPC error:', cleanErr);
        }
      }

      return NextResponse.json(
        { error: rpcErr.message || 'Failed to update player profile' },
        { status: 500 }
      );
    }

    if (!rpcResult || rpcResult.success === false) {
      if (newUploadedObjectPath) {
        try {
          await supabaseAdmin.storage.from('profile-images').remove([newUploadedObjectPath]);
        } catch (cleanErr) {
          console.error('Failed to cleanup uploaded image after RPC error:', cleanErr);
        }
      }
      return NextResponse.json(
        { error: rpcResult?.error || 'Failed to update player profile' },
        { status: rpcResult?.code || 400 }
      );
    }

    // 9. Return Safe Player DTO from atomic transaction result
    const p = rpcResult.player || {};
    return NextResponse.json({
      success: true,
      noOp: rpcResult.noOp || false,
      message: rpcResult.message,
      changedFields: rpcResult.changedFields || [],
      player: {
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        mobile: p.mobile,
        profile_image_url: p.profile_image_url,
        cricket_role: p.cricket_role,
        batting_style: p.batting_style,
        bowling_style: p.bowling_style,
        jersey_name: p.jersey_name,
        jersey_number: p.jersey_number,
        jersey_size: p.jersey_size,
        created_at: p.created_at,
        updated_at: p.updated_at,
      },
    });
  } catch (err: any) {
    console.error('Error in PATCH /api/admin/players/[id]:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyAdminAuth();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id: playerId } = await params;

    if (!playerId) {
      return NextResponse.json({ error: 'Player ID is required' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // 1. Fetch player registrations
    const { data: playerRegs } = await supabase
      .from('registrations')
      .select('id')
      .eq('player_id', playerId);

    const regIds = (playerRegs || []).map((r) => r.id);

    // 2. Delete payments linked to these registrations
    if (regIds.length > 0) {
      await supabase.from('payments').delete().in('registration_id', regIds);
      await supabase.from('registrations').delete().in('id', regIds);
    }

    // 3. Delete team owners associated with this player_id
    await supabase.from('team_owners').delete().eq('player_id', playerId);

    // 4. Delete player profile record
    const { error: delErr } = await supabase
      .from('players')
      .delete()
      .eq('id', playerId);

    if (delErr) {
      throw delErr;
    }

    await logAdminAction({
      adminUserId: auth.user!.id,
      action: 'DELETE_PLAYER',
      entityType: 'PLAYER',
      entityId: playerId,
    });

    return NextResponse.json({
      success: true,
      message: 'Player profile and all associated data deleted successfully',
    });
  } catch (err: any) {
    const status = err.message?.includes('Unauthorized') ? 403 : 500;
    return NextResponse.json({ error: err.message || 'Failed to delete player entry' }, { status });
  }
}
