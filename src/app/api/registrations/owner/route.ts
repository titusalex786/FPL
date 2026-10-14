import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { uploadToStorageBucket, validateImageFileBuffer } from '@/lib/storage/upload';
import { playerCricketDetailsSchema } from '@/lib/validation/registration';
import { logAdminAction } from '@/lib/audit/logger';

export async function POST(req: NextRequest) {
  try {
    const supabaseServer = await createServerSupabaseClient();
    let { data: { user }, error: authError } = await supabaseServer.auth.getUser();

    // Fallback: If cookie session is missing, verify Authorization: Bearer token server-side
    if (!user) {
      const authHeader = req.headers.get('authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7).trim();
        if (token) {
          const supabaseAdmin = createAdminClient();
          const { data: tokenData, error: tokenError } = await supabaseAdmin.auth.getUser(token);
          if (!tokenError && tokenData?.user) {
            user = tokenData.user;
            authError = null;
          }
        }
      }
    }

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

    const ownerCricketDetails = playerCricketDetailsSchema.safeParse({
      cricketRole: ownerRole || 'BATSMAN',
      battingStyle: ownerBattingStyle || 'RIGHT_HAND',
      bowlingStyle: ownerBowlingStyle || null,
    });
    if (!ownerCricketDetails.success) {
      return NextResponse.json(
        { error: 'Invalid Owner cricket role or style', details: ownerCricketDetails.error.issues },
        { status: 400 }
      );
    }

    const iconCricketDetails = playerCricketDetailsSchema.safeParse({
      cricketRole: iconPlayerRole || 'BATSMAN',
      battingStyle: iconPlayerBattingStyle || 'RIGHT_HAND',
      bowlingStyle: iconPlayerBowlingStyle || null,
    });
    if (!iconCricketDetails.success) {
      return NextResponse.json(
        { error: 'Invalid Icon Player cricket role or style', details: iconCricketDetails.error.issues },
        { status: 400 }
      );
    }

    const supabaseAdmin = createAdminClient();

    // Check if caller has admin / manager privileges
    let isManagerOrAdmin = false;
    try {
      const adminRes = await supabaseAdmin
        .from('admin_users')
        .select('id, role, status')
        .eq('id', user.id)
        .eq('status', 'ACTIVE')
        .maybeSingle();
      const adminEntry = adminRes?.data;

      if (adminEntry) {
        isManagerOrAdmin = true;
      } else if (user.email) {
        const managerRes = await supabaseAdmin
          .from('managers')
          .select('id, is_active')
          .ilike('user_email', user.email.toLowerCase())
          .eq('is_active', true)
          .maybeSingle();
        const managerEntry = managerRes?.data;
        if (managerEntry) {
          isManagerOrAdmin = true;
        }
      }
    } catch {
      // Non-fatal, default to false
    }

    const isAdminEntry = Boolean(body.isAdminEntry && isManagerOrAdmin);
    const autoApprove = Boolean((body.autoApprove ?? true) && isAdminEntry);

    let effectiveIconImageSnapshot = iconProfileImageUrl?.trim() || iconPlayerPhotoUrl?.trim() || null;
    if (!effectiveIconImageSnapshot) {
      if (isAdminEntry) {
        const initial = (iconPlayerName?.trim()[0] || 'I').toUpperCase();
        effectiveIconImageSnapshot = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="100%" height="100%" fill="%23042f2e"/><text x="50%" y="55%" font-size="52" font-family="sans-serif" font-weight="bold" fill="%2314b8a6" text-anchor="middle" dominant-baseline="middle">${initial}</text></svg>`;
      } else {
        return NextResponse.json(
          { error: 'Icon player profile photo is required' },
          { status: 400 }
        );
      }
    }

    let effectiveOwnerImageSnapshot = ownerProfileImageUrl?.trim() || null;
    if (!effectiveOwnerImageSnapshot && isAdminEntry) {
      const initial = (ownerName.trim()[0] || 'O').toUpperCase();
      effectiveOwnerImageSnapshot = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="100%" height="100%" fill="%231e293b"/><text x="50%" y="55%" font-size="52" font-family="sans-serif" font-weight="bold" fill="%23f59e0b" text-anchor="middle" dominant-baseline="middle">${initial}</text></svg>`;
    }

    // 1. Resolve Owner Player Record
    let effectiveOwnerPlayerId: string | null = null;

    if (isAdminEntry) {
      // Registering on behalf of an owner: create or lookup owner player record decoupled from admin's auth_user_id
      const normalizedContactEmail = contactEmail.toLowerCase().trim();
      const normalizedContactPhone = contactPhone ? contactPhone.trim() : null;

      const emailLookupRes = await supabaseAdmin
        .from('players')
        .select('id, full_name, email, mobile')
        .ilike('email', normalizedContactEmail)
        .maybeSingle();
      const existingPlayerByEmail = emailLookupRes?.data;

      if (existingPlayerByEmail) {
        effectiveOwnerPlayerId = existingPlayerByEmail.id;
        if (typeof (supabaseAdmin.from('players') as any)?.update === 'function') {
          try {
            await supabaseAdmin
              .from('players')
              .update({
                full_name: ownerName.trim(),
                cricket_role: ownerCricketDetails.data.cricketRole,
                batting_style: ownerCricketDetails.data.battingStyle,
                bowling_style: ownerCricketDetails.data.bowlingStyle || null,
                profile_image_url: effectiveOwnerImageSnapshot || undefined,
                updated_at: new Date().toISOString(),
              })
              .eq('id', effectiveOwnerPlayerId);
          } catch {}
        }
      } else if (normalizedContactPhone) {
        const phoneLookupRes = await supabaseAdmin
          .from('players')
          .select('id, full_name, email, mobile')
          .eq('mobile', normalizedContactPhone)
          .maybeSingle();
        const existingPlayerByPhone = phoneLookupRes?.data;

        if (existingPlayerByPhone) {
          effectiveOwnerPlayerId = existingPlayerByPhone.id;
          if (typeof (supabaseAdmin.from('players') as any)?.update === 'function') {
            try {
              await supabaseAdmin
                .from('players')
                .update({
                  full_name: ownerName.trim(),
                  email: normalizedContactEmail,
                  cricket_role: ownerCricketDetails.data.cricketRole,
                  batting_style: ownerCricketDetails.data.battingStyle,
                  bowling_style: ownerCricketDetails.data.bowlingStyle || null,
                  profile_image_url: effectiveOwnerImageSnapshot || undefined,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', effectiveOwnerPlayerId);
            } catch {}
          }
        }
      }

      if (!effectiveOwnerPlayerId) {
        const newPlayerRes = await supabaseAdmin
          .from('players')
          .insert({
            full_name: ownerName.trim(),
            email: normalizedContactEmail,
            mobile: normalizedContactPhone,
            cricket_role: ownerCricketDetails.data.cricketRole,
            batting_style: ownerCricketDetails.data.battingStyle,
            bowling_style: ownerCricketDetails.data.bowlingStyle || null,
            profile_image_url: effectiveOwnerImageSnapshot,
            is_tournament_only: true,
            player_type: 'OWNER',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select('id')
          .single();
        const newOwnerPlayer = newPlayerRes?.data;
        const createOwnerErr = newPlayerRes?.error;

        if (createOwnerErr || !newOwnerPlayer?.id) {
          console.error('Failed to create owner player profile on behalf of admin:', createOwnerErr);
          return NextResponse.json(
            { error: 'Failed to create owner player profile: ' + (createOwnerErr?.message || 'Unknown error') },
            { status: 500 }
          );
        }
        effectiveOwnerPlayerId = newOwnerPlayer.id;
      }
    } else {
      // Standard flow: Resolve Owner Player Record from Authenticated Session ONLY
      const profileRes = await supabaseServer
        .from('players')
        .select('id')
        .eq('auth_user_id', user.id)
        .maybeSingle();
      const playerProfile = profileRes?.data;
      const profileErr = profileRes?.error;

      effectiveOwnerPlayerId = playerProfile?.id;

      if (profileErr || !effectiveOwnerPlayerId) {
        // Auto-create owner player profile if missing
        const newOwnerRes = await createAdminClient()
          .from('players')
          .upsert({
            auth_user_id: user.id,
            full_name: ownerName.trim(),
            email: contactEmail.toLowerCase().trim(),
            mobile: contactPhone || null,
            cricket_role: ownerCricketDetails.data.cricketRole,
            batting_style: ownerCricketDetails.data.battingStyle,
            bowling_style: ownerCricketDetails.data.bowlingStyle || null,
            profile_image_url: ownerProfileImageUrl || null,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'auth_user_id' })
          .select('id')
          .single();
        const newOwnerPlayer = newOwnerRes?.data;
        const createOwnerErr = newOwnerRes?.error;

        if (createOwnerErr || !newOwnerPlayer?.id) {
          return NextResponse.json(
            { error: 'You must complete your player profile before registering as a team owner.' },
            { status: 400 }
          );
        }
        effectiveOwnerPlayerId = newOwnerPlayer.id;
      }
    }

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
    const effectiveOwnerRole = ownerCricketDetails.data.cricketRole;
    const effectiveOwnerBattingStyle = ownerCricketDetails.data.battingStyle;
    const effectiveOwnerBowlingStyle = ownerCricketDetails.data.bowlingStyle || null;
    const effectiveOwnerJerseySize = ownerJerseySize?.trim() || 'M';
    if (!effectiveOwnerImageSnapshot) {
      effectiveOwnerImageSnapshot = ownerProfileImageUrl?.trim() || null;
    }
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
        p_icon_role: iconCricketDetails.data.cricketRole,
        p_icon_batting_style: iconCricketDetails.data.battingStyle,
        p_icon_bowling_style: iconCricketDetails.data.bowlingStyle || null,
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
      let safeError = 'We could not complete the owner registration. Please try again or contact the organiser.';
      let errorCode: string | undefined = undefined;

      if (
        rawError.includes('This team name is already registered') ||
        rawError.includes('uq_team_owners_tournament_team_name') ||
        rawError.includes('team name')
      ) {
        safeError = 'This team name is already registered for this tournament. Please choose another team name.';
        errorCode = 'DUPLICATE_TEAM_NAME';
      } else if (
        rawError.includes('already registered as a team owner') ||
        rawError.includes('uq_registrations_owner_team_owner')
      ) {
        safeError = 'You are already registered as a team owner for this tournament.';
        errorCode = 'DUPLICATE_OWNER_REGISTRATION';
      } else if (
        rawError.includes('icon player registration already exists') ||
        rawError.includes('uq_registrations_icon_team_owner')
      ) {
        safeError = 'An icon player registration already exists for this team.';
        errorCode = 'DUPLICATE_ICON_REGISTRATION';
      } else if (rawError.includes('All owner slots')) {
        safeError = 'Registration could not be completed because all team owner slots for this tournament are filled.';
        errorCode = 'TEAM_LIMIT_REACHED';
      } else if (rawError.includes('Insufficient player slots')) {
        safeError = 'Registration could not be completed because there are not enough player slots remaining for Owner + Icon.';
        errorCode = 'PLAYER_CAPACITY_REACHED';
      } else if (rawError.includes('Owner-based tournament not found')) {
        safeError = 'Owner-based tournament not found.';
      } else if (rawError.includes('Registration slot collision')) {
        safeError = 'Registration slot collision. Please try again.';
      }
      return NextResponse.json(
        { error: safeError, ...(errorCode ? { code: errorCode } : {}) },
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

    // 6. Handle Immediate Auto-Approval for Admin Registrations
    let finalStatus = result.status;
    if (autoApprove) {
      try {
        // Update team_owner to APPROVED
        await supabaseAdmin
          .from('team_owners')
          .update({
            status: 'APPROVED',
            payment_status: 'SUCCESSFUL',
            updated_at: new Date().toISOString(),
          })
          .eq('id', result.owner_id);

        // Update owner registration to CONFIRMED
        await supabaseAdmin
          .from('registrations')
          .update({
            registration_status: 'CONFIRMED',
            status: 'CONFIRMED',
            updated_at: new Date().toISOString(),
          })
          .eq('id', ownerRegistrationId);

        // Update icon registration to CONFIRMED
        if (iconRegistrationId) {
          await supabaseAdmin
            .from('registrations')
            .update({
              registration_status: 'CONFIRMED',
              status: 'CONFIRMED',
              updated_at: new Date().toISOString(),
            })
            .eq('id', iconRegistrationId);
        }

        // Mark payment record SUCCESSFUL
        if (result.payment_id) {
          await supabaseAdmin
            .from('payments')
            .update({
              payment_status: 'SUCCESSFUL',
              verified_at: new Date().toISOString(),
              verified_by: user.id,
              verification_notes: 'Direct registration & auto-approval by Admin',
              updated_at: new Date().toISOString(),
            })
            .eq('id', result.payment_id);
        }

        finalStatus = 'APPROVED';

        // Write Audit Log
        await logAdminAction({
          adminUserId: user.id,
          action: 'ADMIN_REGISTER_OWNER_AND_ICON',
          entityType: 'team_owners',
          entityId: result.owner_id,
          newValue: {
            tournamentId,
            teamName,
            ownerName,
            contactEmail,
            iconPlayerName,
            autoApproved: true,
          },
        });
      } catch (autoApproveErr) {
        console.error('Non-fatal error in auto-approve post-processing:', autoApproveErr);
      }
    }

    return NextResponse.json({
      success: true,
      ownerId: result.owner_id,
      slotNumber: result.slot_number,
      ownerRegistrationId: result.owner_registration_id,
      iconRegistrationId: result.icon_registration_id,
      paymentId: result.payment_id,
      status: finalStatus,
      message: autoApprove
        ? `Team Owner & Icon registered and approved successfully! Slot #${result.slot_number} assigned to ${teamName || ownerName}.`
        : `Owner registration completed atomically! Slot #${result.slot_number} assigned.`,
    });
  } catch (err: any) {
    console.error('Owner Registration Endpoint Error:', err);
    return NextResponse.json(
      { error: 'We could not complete the owner registration. Please try again or contact the organiser.' },
      { status: 500 }
    );
  }
}
