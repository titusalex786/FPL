import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { uploadToStorageBucket, validateImageFileBuffer } from '@/lib/storage/upload';

export async function POST(req: NextRequest) {
  try {
    const supabaseServer = await createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabaseServer.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await req.json();

    const {
      tournamentId,
      // Owner identity (contact / team)
      ownerName,
      contactEmail,
      contactPhone,
      // Owner Player #1 complete snapshot fields
      ownerRole,
      ownerBattingStyle,
      ownerBowlingStyle,
      ownerJerseySize,
      ownerProfileImageUrl,
      // Team
      teamName,
      teamLogoUrl,
      teamLogoBase64,
      // Payment
      paymentScreenshotBase64,
      paymentMethod = 'UPI_QR',
      // Icon Player #2 fields
      iconPlayerName,
      iconPlayerMobile,
      iconPlayerRole,
      iconPlayerBattingStyle,
      iconPlayerBowlingStyle,
      iconProfileImageUrl,
      iconPlayerPhotoUrl,
    } = body;

    if (!tournamentId || !ownerName || !contactEmail) {
      return NextResponse.json(
        { error: 'Tournament ID, Owner Name, and Contact Email are required' },
        { status: 400 }
      );
    }

    const effectiveIconImageSnapshot = iconProfileImageUrl?.trim() || iconPlayerPhotoUrl?.trim() || null;
    if (!effectiveIconImageSnapshot) {
      return NextResponse.json(
        { error: 'Icon player profile photo is required' },
        { status: 400 }
      );
    }

    // 1. Resolve Owner Player Record from Authenticated Session ONLY
    const { data: playerProfile, error: profileErr } = await supabaseServer
      .from('players')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    let effectiveOwnerPlayerId = playerProfile?.id;

    if (profileErr || !effectiveOwnerPlayerId) {
      // Auto-create owner player profile if missing
      const { data: newOwnerPlayer, error: createOwnerErr } = await createAdminClient()
        .from('players')
        .upsert({
          auth_user_id: user.id,
          full_name: ownerName.trim(),
          email: contactEmail.toLowerCase().trim(),
          mobile: contactPhone || null,
          cricket_role: ownerRole || 'BATSMAN',
          batting_style: ownerBattingStyle || 'RIGHT_HAND',
          profile_image_url: ownerProfileImageUrl || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'auth_user_id' })
        .select('id')
        .single();

      if (createOwnerErr || !newOwnerPlayer?.id) {
        return NextResponse.json(
          { error: 'You must complete your player profile before registering as a team owner.' },
          { status: 400 }
        );
      }
      effectiveOwnerPlayerId = newOwnerPlayer.id;
    }

    const supabaseAdmin = createAdminClient();

    // 2. Handle Team Logo File Upload
    let effectiveTeamLogoUrl: string | null = null;
    const logoInput = teamLogoBase64 || (teamLogoUrl && teamLogoUrl.startsWith('data:image/') ? teamLogoUrl : null);

    if (teamLogoUrl && (teamLogoUrl.startsWith('http://') || teamLogoUrl.startsWith('https://')) && !teamLogoBase64) {
      return NextResponse.json(
        { error: 'Arbitrary external team logo URLs are not allowed. Please upload an image file (JPEG, PNG, WebP).' },
        { status: 400 }
      );
    }

    if (logoInput) {
      const cleanLogoBase64 = logoInput.replace(/^data:image\/\w+;base64,/, '');
      const logoBuffer = Buffer.from(cleanLogoBase64, 'base64');
      const logoValidation = validateImageFileBuffer(logoBuffer);

      if (!logoValidation.isValid || !logoValidation.mimeType) {
        return NextResponse.json(
          { error: logoValidation.error || 'Invalid team logo file format' },
          { status: 400 }
        );
      }

      const logoExt = logoValidation.mimeType === 'image/jpeg' ? 'jpg' : logoValidation.mimeType === 'image/webp' ? 'webp' : 'png';
      const logoPath = `${tournamentId}/${effectiveOwnerPlayerId}/${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${logoExt}`;

      try {
        const logoUpload = await uploadToStorageBucket('team-logos', logoPath, logoBuffer, logoValidation.mimeType);
        effectiveTeamLogoUrl = logoUpload.publicUrl || logoPath;
      } catch (uploadErr: any) {
        return NextResponse.json({ error: uploadErr.message || 'Failed to upload team logo' }, { status: 400 });
      }
    }

    // 3. Pre-validate Payment Screenshot File
    const screenshotBucket = 'payment-screenshots';
    let screenshotBuffer: Buffer | null = null;
    let screenshotValidation: any = null;

    if (paymentScreenshotBase64 && paymentMethod !== 'ACKNOWLEDGE_BY_ORGANISER') {
      const cleanBase64 = paymentScreenshotBase64.replace(/^data:image\/\w+;base64,/, '');
      screenshotBuffer = Buffer.from(cleanBase64, 'base64');
      screenshotValidation = validateImageFileBuffer(screenshotBuffer);

      if (!screenshotValidation.isValid || !screenshotValidation.mimeType || !screenshotValidation.extension) {
        return NextResponse.json(
          { error: screenshotValidation.error || 'Invalid payment screenshot file format' },
          { status: 400 }
        );
      }
    }

    // Normalise Owner Player #1 snapshot fields
    const effectiveOwnerRole = ownerRole?.trim() || 'BATSMAN';
    const effectiveOwnerBattingStyle = ownerBattingStyle?.trim() || 'RIGHT_HAND';
    const effectiveOwnerBowlingStyle = ownerBowlingStyle?.trim() || null;
    const effectiveOwnerJerseySize = ownerJerseySize?.trim() || 'M';
    const effectiveOwnerImageSnapshot = ownerProfileImageUrl?.trim() || null;
    // Jersey snapshot extraction
    const effectiveOwnerJerseyName = (body.ownerJerseyName || body.jerseyName || ownerName).trim();
    const effectiveOwnerJerseyNumber = body.ownerJerseyNumber ? body.ownerJerseyNumber.trim() : null;
    const effectiveIconJerseyName = body.iconJerseyName ? body.iconJerseyName.trim() : (iconPlayerName || null);
    const effectiveIconJerseyNumber = body.iconJerseyNumber ? body.iconJerseyNumber.trim() : null;
    const effectiveIconJerseySize = body.iconJerseySize ? body.iconJerseySize.trim() : 'M';

    // 4. Call Atomic PostgreSQL RPC: allocate_owner_registration_v4
    const rpcResV4 = await supabaseAdmin.rpc(
      'allocate_owner_registration_v4',
      {
        p_tournament_id: tournamentId,
        p_owner_player_id: effectiveOwnerPlayerId,
        p_owner_name: ownerName.trim(),
        p_contact_email: contactEmail.toLowerCase().trim(),
        p_contact_phone: contactPhone || null,
        p_team_name: teamName?.trim() || `Team ${ownerName.trim()}`,
        p_owner_role: effectiveOwnerRole,
        p_owner_batting_style: effectiveOwnerBattingStyle,
        p_owner_bowling_style: effectiveOwnerBowlingStyle,
        p_owner_jersey_size: effectiveOwnerJerseySize,
        p_owner_image_snapshot: effectiveOwnerImageSnapshot,
        p_team_logo_url: effectiveTeamLogoUrl,
        p_screenshot_bucket: screenshotBucket,
        p_screenshot_object_path: null,
        p_icon_name: iconPlayerName?.trim() || ownerName.trim(),
        p_icon_mobile: iconPlayerMobile || contactPhone || null,
        p_icon_role: iconPlayerRole || 'BATSMAN',
        p_icon_batting_style: iconPlayerBattingStyle || 'RIGHT_HAND',
        p_icon_bowling_style: iconPlayerBowlingStyle || null,
        p_created_by_auth_id: user.id,
        p_payment_method: paymentMethod || 'UPI_QR',
        p_icon_image_snapshot: effectiveIconImageSnapshot,
        p_owner_jersey_name: effectiveOwnerJerseyName,
        p_owner_jersey_number: effectiveOwnerJerseyNumber,
        p_icon_jersey_name: effectiveIconJerseyName,
        p_icon_jersey_number: effectiveIconJerseyNumber,
        p_icon_jersey_size: effectiveIconJerseySize,
      }
    );

    if (rpcResV4.error || !rpcResV4.data || rpcResV4.data.length === 0) {
      console.error('RPC Error allocate_owner_registration_v4:', rpcResV4.error);
      const rawError = rpcResV4.error?.message || 'Failed to allocate owner slot atomically';
      let safeError = rawError;
      if (rawError.includes('already exists') || rawError.includes('already registered')) {
        safeError = 'You or a team with this name is already registered for this tournament.';
      } else if (rawError.includes('All owner slots')) {
        safeError = 'Registration could not be completed because all team owner slots for this tournament are filled.';
      } else if (rawError.includes('Insufficient player slots')) {
        safeError = 'Registration could not be completed because there are not enough player slots remaining for Owner + Icon.';
      }
      return NextResponse.json(
        { error: safeError },
        { status: 400 }
      );
    }

    const result = rpcResV4.data[0];
    const ownerRegistrationId = result.owner_registration_id;
    const iconRegistrationId = result.icon_registration_id;

    // Guarantee snapshot consistency for historical immutability if update function is available
    if (typeof (supabaseAdmin.from('registrations') as any)?.update === 'function') {
      try {
        await supabaseAdmin
          .from('registrations')
          .update({
            registered_jersey_name_snapshot: effectiveOwnerJerseyName,
            registered_jersey_number_snapshot: effectiveOwnerJerseyNumber,
          })
          .eq('id', ownerRegistrationId);

        if (iconRegistrationId) {
          await supabaseAdmin
            .from('registrations')
            .update({
              registered_jersey_name_snapshot: effectiveIconJerseyName,
              registered_jersey_number_snapshot: effectiveIconJerseyNumber,
              registered_jersey_size_snapshot: effectiveIconJerseySize,
            })
            .eq('id', iconRegistrationId);
        }
      } catch {}
    }

    // Update owner player profile defaults if update function is available
    if (typeof (supabaseAdmin.from('players') as any)?.update === 'function') {
      try {
        await supabaseAdmin
          .from('players')
          .update({
            jersey_name: effectiveOwnerJerseyName,
            jersey_number: effectiveOwnerJerseyNumber,
            updated_at: new Date().toISOString(),
          })
          .eq('id', effectiveOwnerPlayerId);
      } catch {}
    }

    // 5. Upload Payment Screenshot to Storage
    let screenshotObjectPath: string | null = null;
    if (screenshotBuffer && screenshotValidation) {
      const ext = screenshotValidation.extension;
      const filename = `${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${ext}`;
      screenshotObjectPath = `${tournamentId}/${ownerRegistrationId}/${filename}`;

      try {
        await uploadToStorageBucket(screenshotBucket, screenshotObjectPath, screenshotBuffer, screenshotValidation.mimeType);

        if (result.payment_id) {
          await supabaseAdmin
            .from('payments')
            .update({
              screenshot_bucket: screenshotBucket,
              screenshot_object_path: screenshotObjectPath,
            })
            .eq('id', result.payment_id);
        }
      } catch (uploadErr: any) {
        console.error('Failed to upload owner payment screenshot:', uploadErr);
      }
    }

    return NextResponse.json({
      success: true,
      ownerId: result.owner_id,
      slotNumber: result.slot_number,
      ownerRegistrationId: result.owner_registration_id,
      iconRegistrationId: result.icon_registration_id,
      paymentId: result.payment_id,
      status: result.status,
      message: `Owner registration completed atomically! Slot #${result.slot_number} assigned.`,
    });
  } catch (err: any) {
    console.error('Owner Registration Endpoint Error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
