import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkIsAdmin } from '@/lib/auth/is-admin';
import { uploadToStorageBucket, validateImageFileBuffer } from '@/lib/storage/upload';
import { sendNotification } from '@/lib/notifications/create-notification';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabaseServer = await createServerSupabaseClient();
    const {
      data: { user },
      error: authErr,
    } = await supabaseServer.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: registrationId } = await params;
    const body = await req.json();

    const supabaseAdmin = createAdminClient();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(registrationId);
    let regQuery = supabaseAdmin
      .from('registrations')
      .select('*, player:players(*), tournament:tournaments(*)');

    if (isUuid) {
      regQuery = regQuery.eq('id', registrationId);
    } else {
      regQuery = regQuery.eq('registration_number', registrationId);
    }

    const { data: registration, error: regErr } = await regQuery.maybeSingle();

    if (regErr || !registration) {
      return NextResponse.json({ error: 'Registration not found' }, { status: 404 });
    }

    // Verify ownership: must be created_by_auth_id OR player.auth_user_id OR admin
    const { isAdmin } = await checkIsAdmin();
    const isOwner =
      registration.created_by_auth_id === user.id ||
      registration.player?.auth_user_id === user.id;

    if (!isAdmin && !isOwner) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (registration.registration_status !== 'CORRECTION_REQUESTED') {
      return NextResponse.json({ error: 'Correction not requested for this registration' }, { status: 400 });
    }

    // =========================================================================
    // CRITICAL #4 — SERVER-SIDE INPUT VALIDATION
    // Validate and normalise every correctable field before touching the DB.
    // Uses the same enum values as the DB schema and the normal registration flow.
    // Unknown request body fields are ignored — only explicitly allowed fields
    // are ever written to the database.
    // =========================================================================
    const VALID_CRICKET_ROLES = [
      'BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'BATSMAN_WICKETKEEPER', 'BOWLER_WICKETKEEPER',
    ] as const;
    const VALID_BATTING_STYLES = ['RIGHT_HAND', 'LEFT_HAND'] as const;
    const VALID_BOWLING_STYLES = [
      'RIGHT_ARM_FAST', 'RIGHT_ARM_MEDIUM', 'RIGHT_ARM_SPIN',
      'LEFT_ARM_FAST', 'LEFT_ARM_MEDIUM', 'LEFT_ARM_SPIN',
      'DOESNT_BOWL',
    ] as const;
    const VALID_JERSEY_SIZES = ['S', 'M', 'L', 'XL', 'XXL', '3XL'] as const;

    const validationErrors: string[] = [];

    // Validate Name (min 2, max 100 characters)
    const rawName = body.name !== undefined ? body.name : body.full_name;
    if (rawName !== undefined) {
      const trimmed = String(rawName).trim();
      if (trimmed.length < 2) {
        validationErrors.push('Name must be at least 2 characters');
      }
      if (trimmed.length > 100) {
        validationErrors.push('Name must not exceed 100 characters');
      }
    }

    // Validate Jersey Name (max 30 chars)
    if (body.jersey_name !== undefined) {
      const trimmed = String(body.jersey_name).trim();
      if (trimmed.length > 30) {
        validationErrors.push('Jersey Name must not exceed 30 characters');
      }
    }

    // Validate Jersey Number (max 10 chars, alphanumeric only)
    if (body.jersey_number !== undefined) {
      const trimmed = String(body.jersey_number).trim();
      if (trimmed.length > 10) {
        validationErrors.push('Jersey Number must not exceed 10 characters');
      }
      if (trimmed.length > 0 && !/^[A-Za-z0-9]+$/.test(trimmed)) {
        validationErrors.push('Jersey Number must be alphanumeric');
      }
    }

    // Validate Jersey Size (strict enum)
    if (body.jersey_size !== undefined) {
      const val = String(body.jersey_size).trim().toUpperCase();
      if (!(VALID_JERSEY_SIZES as readonly string[]).includes(val)) {
        validationErrors.push(`Jersey Size must be one of: ${VALID_JERSEY_SIZES.join(', ')}`);
      }
    }

    // Validate Cricket Role (strict enum)
    if (body.cricket_role !== undefined) {
      const val = String(body.cricket_role).trim().toUpperCase();
      if (!(VALID_CRICKET_ROLES as readonly string[]).includes(val)) {
        validationErrors.push(`Cricket Role must be one of: ${VALID_CRICKET_ROLES.join(', ')}`);
      }
    }

    // Validate Batting Style (strict enum)
    if (body.batting_style !== undefined) {
      const val = String(body.batting_style).trim().toUpperCase();
      if (!(VALID_BATTING_STYLES as readonly string[]).includes(val)) {
        validationErrors.push(`Batting Style must be one of: ${VALID_BATTING_STYLES.join(', ')}`);
      }
    }

    // Validate Bowling Style (strict enum)
    if (body.bowling_style !== undefined) {
      const val = String(body.bowling_style).trim().toUpperCase();
      if (!(VALID_BOWLING_STYLES as readonly string[]).includes(val)) {
        validationErrors.push(`Bowling Style must be one of: ${VALID_BOWLING_STYLES.join(', ')}`);
      }
    }

    // Validate UPI / Transaction Reference (max 100 chars, safe characters)
    const rawTxnRef = (body.transaction_reference || body.transactionReference || '').trim();
    if (rawTxnRef.length > 100) {
      validationErrors.push('Transaction Reference must not exceed 100 characters');
    }
    if (rawTxnRef.length > 0 && !/^[A-Za-z0-9@._\-/ ]+$/.test(rawTxnRef)) {
      validationErrors.push('Transaction Reference contains invalid characters');
    }

    if (validationErrors.length > 0) {
      return NextResponse.json(
        { error: validationErrors.join('. ') },
        { status: 400 }
      );
    }

    // =========================================================================
    // Resolve active correction history entry
    // =========================================================================
    const existingHistory: any[] = Array.isArray(registration.correction_history)
      ? registration.correction_history
      : [];

    let activeIdx = -1;
    for (let i = existingHistory.length - 1; i >= 0; i--) {
      if (!existingHistory[i].resolved_at) {
        activeIdx = i;
        break;
      }
    }

    // If no explicit unresolved item, fallback to latest
    if (activeIdx === -1 && existingHistory.length > 0) {
      activeIdx = existingHistory.length - 1;
    }

    const activeCorrection = activeIdx >= 0 ? existingHistory[activeIdx] : {};
    const requestedFields: string[] = activeCorrection.requested_fields || [];
    const allowAllFields = requestedFields.length === 0;

    const now = new Date().toISOString();
    const updatePayload: Record<string, any> = {
      updated_at: now,
      registration_status: 'PENDING',
      status: 'PENDING',
      resubmission_count: (registration.resubmission_count || 0) + 1,
    };

    const oldValues: Record<string, any> = {};
    const newValues: Record<string, any> = {};

    // 0. Name — validated above
    if (
      (allowAllFields || requestedFields.some((f) => /name/i.test(f))) &&
      rawName !== undefined
    ) {
      const val = String(rawName).trim();
      oldValues['Player Name'] = registration.registered_name_snapshot;
      newValues['Player Name'] = val;
      updatePayload.registered_name_snapshot = val;
    }

    // 1. Jersey Name — validated and normalised above
    if (
      (allowAllFields || requestedFields.some((f) => /jersey\s*name/i.test(f))) &&
      body.jersey_name !== undefined
    ) {
      const val = String(body.jersey_name).trim();
      oldValues['Jersey Name'] = registration.registered_jersey_name_snapshot;
      newValues['Jersey Name'] = val;
      updatePayload.registered_jersey_name_snapshot = val;
    }

    // 2. Jersey Number — validated and normalised above
    if (
      (allowAllFields || requestedFields.some((f) => /jersey\s*number/i.test(f))) &&
      body.jersey_number !== undefined
    ) {
      const val = String(body.jersey_number).trim();
      oldValues['Jersey Number'] = registration.registered_jersey_number_snapshot;
      newValues['Jersey Number'] = val;
      updatePayload.registered_jersey_number_snapshot = val;
    }

    // 3. Jersey Size — validated and normalised above
    if (
      (allowAllFields || requestedFields.some((f) => /jersey\s*size/i.test(f))) &&
      body.jersey_size !== undefined
    ) {
      const val = String(body.jersey_size).trim().toUpperCase();
      oldValues['Jersey Size'] = registration.registered_jersey_size_snapshot;
      newValues['Jersey Size'] = val;
      updatePayload.registered_jersey_size_snapshot = val;
    }

    // 4. Profile Photo / Image
    if (
      (allowAllFields || requestedFields.some((f) => /photo|image/i.test(f))) &&
      (body.profile_image !== undefined || body.profile_image_url !== undefined)
    ) {
      let imgVal = String(body.profile_image || body.profile_image_url || '').trim();
      if (imgVal.startsWith('data:image/')) {
        try {
          const cleanBase64 = imgVal.replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(cleanBase64, 'base64');
          const validation = validateImageFileBuffer(buffer);
          if (validation.isValid && validation.mimeType) {
            const ext = validation.extension || (validation.mimeType === 'image/jpeg' ? 'jpg' : validation.mimeType === 'image/webp' ? 'webp' : 'png');
            const objectPath = `${registration.tournament_id}/${registration.id}/${Date.now()}_profile_${Math.random().toString(36).substring(2, 6)}.${ext}`;
            const uploadRes = await uploadToStorageBucket('profile-images', objectPath, buffer, validation.mimeType);
            imgVal = uploadRes.publicUrl || objectPath;
          }
        } catch (uploadErr) {
          console.warn('[correction] Profile image upload fallback to raw value:', uploadErr);
        }
      }
      oldValues['Profile Image'] = registration.registered_image_snapshot;
      newValues['Profile Image'] = imgVal ? 'Updated' : 'Cleared';
      updatePayload.registered_image_snapshot = imgVal;
    }

    // 5. Cricket Role — validated and normalised above
    if (
      (allowAllFields || requestedFields.some((f) => /role/i.test(f))) &&
      body.cricket_role !== undefined
    ) {
      const val = String(body.cricket_role).trim().toUpperCase();
      oldValues['Cricket Role'] = registration.registered_role_snapshot;
      newValues['Cricket Role'] = val;
      updatePayload.registered_role_snapshot = val;
    }

    // 6. Batting Style — validated and normalised above
    if (
      (allowAllFields || requestedFields.some((f) => /batting/i.test(f))) &&
      body.batting_style !== undefined
    ) {
      const val = String(body.batting_style).trim().toUpperCase();
      oldValues['Batting Style'] = registration.registered_batting_style_snapshot;
      newValues['Batting Style'] = val;
      updatePayload.registered_batting_style_snapshot = val;
    }

    // 7. Bowling Style — validated and normalised above
    if (
      (allowAllFields || requestedFields.some((f) => /bowling/i.test(f))) &&
      body.bowling_style !== undefined
    ) {
      const val = String(body.bowling_style).trim().toUpperCase();
      oldValues['Bowling Style'] = registration.registered_bowling_style_snapshot;
      newValues['Bowling Style'] = val;
      updatePayload.registered_bowling_style_snapshot = val;
    }

    // 8. Payment Screenshot & Transaction Reference
    const rawImageInput = body.screenshotBase64 || (body.screenshot_url && body.screenshot_url.startsWith('data:image/') ? body.screenshot_url : null);
    const txnRef = rawTxnRef; // already validated and trimmed above

    if (rawImageInput || txnRef) {
      const { data: existingPayment } = await supabaseAdmin
        .from('payments')
        .select('*')
        .eq('registration_id', registrationId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let screenshotBucket: string | undefined;
      let screenshotObjectPath: string | undefined;

      if (rawImageInput) {
        const cleanBase64 = rawImageInput.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');
        const validation = validateImageFileBuffer(buffer);

        if (validation.isValid && validation.mimeType) {
          const ext = validation.mimeType === 'image/jpeg' ? 'jpg' : validation.mimeType === 'image/webp' ? 'webp' : 'png';
          screenshotBucket = 'payment-screenshots';
          screenshotObjectPath = `${registration.tournament_id}/${registration.id}/${Date.now()}_correction_${Math.random().toString(36).substring(2, 6)}.${ext}`;
          await uploadToStorageBucket(screenshotBucket, screenshotObjectPath, buffer, validation.mimeType);
        }
      }

      const paymentUpdatePayload: Record<string, any> = {
        payment_status: 'PENDING',
        verification_note: 'Updated by player via correction resubmission. Awaiting Admin verification.',
        updated_at: now,
      };

      if (txnRef) {
        paymentUpdatePayload.transaction_reference = txnRef;
        newValues['Transaction Reference'] = txnRef;
      }

      if (screenshotObjectPath) {
        paymentUpdatePayload.screenshot_bucket = screenshotBucket;
        paymentUpdatePayload.screenshot_object_path = screenshotObjectPath;
        newValues['Payment Screenshot'] = 'Uploaded new screenshot';
      }

      if (existingPayment) {
        await supabaseAdmin
          .from('payments')
          .update(paymentUpdatePayload)
          .eq('id', existingPayment.id);
      } else {
        const tFee = registration.tournament?.registration_fee || 50000;
        await supabaseAdmin.from('payments').insert({
          registration_id: registrationId,
          amount: tFee,
          player_fee_paise: tFee,
          payment_method: 'UPI_QR',
          ...paymentUpdatePayload,
        });
      }
    } else {
      // Even if no new screenshot was provided, ensure any existing payment is in PENDING status for the queue
      await supabaseAdmin
        .from('payments')
        .update({
          payment_status: 'PENDING',
          updated_at: now,
        })
        .eq('registration_id', registrationId);
    }

    // =========================================================================
    // CRITICAL #1 — IMMUTABLE HISTORY UPDATE
    // Never mutate the array or objects returned directly from the database.
    // Build a completely new history array: every previous entry is preserved
    // as-is (spread into a new object if needed), and the active entry is
    // replaced with a new object that adds the resolved fields.
    // =========================================================================
    if (activeIdx >= 0) {
      const updatedHistory = existingHistory.map((entry: any, i: number) => {
        if (i === activeIdx) {
          // Create a brand-new object — the original DB object is never touched
          return {
            ...entry,
            remark: entry.remark || entry.original_remark || registration.admin_remarks,
            original_remark: entry.original_remark || entry.remark || registration.admin_remarks,
            requested_date: entry.requested_date || entry.requested_at || registration.correction_requested_at,
            submitted_date: now,
            resolved_at: now,
            resolved_by_auth_id: user.id,
            resubmission_count: (registration.resubmission_count || 0) + 1,
            changed_fields: Object.keys(newValues),
            previous_values: oldValues,
            old_values: oldValues,
            new_values: newValues,
          };
        }
        // All other history entries pass through unchanged
        return entry;
      });
      updatePayload.correction_history = updatedHistory;
    } else {
      updatePayload.correction_history = [
        ...existingHistory,
        {
          remark: registration.admin_remarks || 'Admin requested correction',
          original_remark: registration.admin_remarks || 'Admin requested correction',
          requested_date: registration.correction_requested_at || registration.updated_at || now,
          submitted_date: now,
          resolved_at: now,
          resolved_by_auth_id: user.id,
          resubmission_count: (registration.resubmission_count || 0) + 1,
          changed_fields: Object.keys(newValues),
          previous_values: oldValues,
          old_values: oldValues,
          new_values: newValues,
        },
      ];
    }

    const { error: updateErr } = await supabaseAdmin
      .from('registrations')
      .update(updatePayload)
      .eq('id', registration.id);

    if (updateErr) {
      console.error('[correction] Failed to update registration record', {
        operation: 'registrations.update',
        registrationId: registration.id,
      });
      return NextResponse.json({ error: 'Failed to update registration' }, { status: 500 });
    }

    // Create admin notifications via sendNotification (with duplicate suppression)
    const { data: adminUsers } = await supabaseAdmin
      .from('admin_users')
      .select('id')
      .limit(10);

    const playerName = updatePayload.registered_name_snapshot || registration.registered_name_snapshot || 'Player';
    const regNumber = registration.registration_number || '';

    if (adminUsers && adminUsers.length > 0) {
      for (const adminUser of adminUsers) {
        await sendNotification({
          userId: adminUser.id,
          type: 'CORRECTION_SUBMITTED',
          title: 'Correction Resubmitted',
          message: `Player has resubmitted registration after correction. (${playerName} - ${regNumber})`,
          registrationId: registration.id,
          tournamentId: registration.tournament_id,
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Correction resubmitted successfully. Your registration is now under Payment Verification.',
    });
  } catch (err: any) {
    console.error('[correction] Unhandled error in correction route', {
      operation: 'POST /api/registrations/[id]/correction',
      message: err?.message,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
