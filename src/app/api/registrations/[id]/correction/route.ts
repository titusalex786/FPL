import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkIsAdmin } from '@/lib/auth/is-admin';
import { uploadToStorageBucket, validateImageFileBuffer } from '@/lib/storage/upload';

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
    const { data: registration, error: regErr } = await supabaseAdmin
      .from('registrations')
      .select('*, player:players(*), tournament:tournaments(*)')
      .eq('id', registrationId)
      .maybeSingle();

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

    const history = registration.correction_history || [];
    let activeIdx = -1;
    for (let i = history.length - 1; i >= 0; i--) {
      if (!history[i].resolved_at) {
        activeIdx = i;
        break;
      }
    }

    // If no explicit unresolved item, fallback to latest or create one
    if (activeIdx === -1 && history.length > 0) {
      activeIdx = history.length - 1;
    }

    const activeCorrection = activeIdx >= 0 ? history[activeIdx] : {};
    const requestedFields = activeCorrection.requested_fields || [];
    const allowAllFields = requestedFields.length === 0;

    const now = new Date().toISOString();
    const updatePayload: any = {
      updated_at: now,
      registration_status: 'PENDING',
      status: 'PENDING',
      resubmission_count: (registration.resubmission_count || 0) + 1,
    };

    const oldValues: any = {};
    const newValues: any = {};

    // 1. Jersey Name
    if ((allowAllFields || requestedFields.includes('Jersey Name')) && body.jersey_name !== undefined) {
      oldValues['Jersey Name'] = registration.registered_jersey_name_snapshot;
      newValues['Jersey Name'] = body.jersey_name;
      updatePayload.registered_jersey_name_snapshot = body.jersey_name;
    }

    // 2. Jersey Number
    if ((allowAllFields || requestedFields.includes('Jersey Number')) && body.jersey_number !== undefined) {
      oldValues['Jersey Number'] = registration.registered_jersey_number_snapshot;
      newValues['Jersey Number'] = body.jersey_number;
      updatePayload.registered_jersey_number_snapshot = body.jersey_number;
    }

    // 3. Jersey Size
    if ((allowAllFields || requestedFields.includes('Jersey Size')) && body.jersey_size !== undefined) {
      oldValues['Jersey Size'] = registration.registered_jersey_size_snapshot;
      newValues['Jersey Size'] = body.jersey_size;
      updatePayload.registered_jersey_size_snapshot = body.jersey_size;
    }

    // 4. Profile Photo / Image
    if (
      (allowAllFields || requestedFields.includes('Profile Image') || requestedFields.includes('Profile Photo')) &&
      (body.profile_image !== undefined || body.profile_image_url !== undefined)
    ) {
      const imgVal = body.profile_image || body.profile_image_url;
      oldValues['Profile Image'] = registration.registered_image_snapshot;
      newValues['Profile Image'] = imgVal ? 'Updated' : 'Cleared';
      updatePayload.registered_image_snapshot = imgVal;
    }

    // 5. Cricket Role
    if ((allowAllFields || requestedFields.includes('Cricket Role')) && body.cricket_role !== undefined) {
      oldValues['Cricket Role'] = registration.registered_role_snapshot;
      newValues['Cricket Role'] = body.cricket_role;
      updatePayload.registered_role_snapshot = body.cricket_role;
    }

    // 6. Batting Style
    if ((allowAllFields || requestedFields.includes('Batting Style')) && body.batting_style !== undefined) {
      oldValues['Batting Style'] = registration.registered_batting_style_snapshot;
      newValues['Batting Style'] = body.batting_style;
      updatePayload.registered_batting_style_snapshot = body.batting_style;
    }

    // 7. Bowling Style
    if ((allowAllFields || requestedFields.includes('Bowling Style')) && body.bowling_style !== undefined) {
      oldValues['Bowling Style'] = registration.registered_bowling_style_snapshot;
      newValues['Bowling Style'] = body.bowling_style;
      updatePayload.registered_bowling_style_snapshot = body.bowling_style;
    }

    // 8. Payment Screenshot & Transaction Reference
    const rawImageInput = body.screenshotBase64 || (body.screenshot_url && body.screenshot_url.startsWith('data:image/') ? body.screenshot_url : null);
    const txnRef = (body.transaction_reference || body.transactionReference || '').trim();

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

      const paymentUpdatePayload: any = {
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

    // Mark active correction in history as resolved
    if (activeIdx >= 0) {
      history[activeIdx].resolved_at = now;
      history[activeIdx].resolved_by_auth_id = user.id;
      history[activeIdx].old_values = oldValues;
      history[activeIdx].new_values = newValues;
      updatePayload.correction_history = history;
    }

    const { error: updateErr } = await supabaseAdmin
      .from('registrations')
      .update(updatePayload)
      .eq('id', registrationId);

    if (updateErr) {
      return NextResponse.json({ error: 'Failed to update registration' }, { status: 500 });
    }

    // Create admin notification
    const { data: adminUsers } = await supabaseAdmin
      .from('admin_users')
      .select('id')
      .limit(5);

    if (adminUsers && adminUsers.length > 0) {
      for (const adminUser of adminUsers) {
        await supabaseAdmin.from('notifications').insert({
          user_id: adminUser.id,
          type: 'CORRECTION_SUBMITTED',
          title: 'Correction Resubmitted',
          message: `Player ${registration.registered_name_snapshot} (${registration.registration_number}) has resubmitted corrected details.`,
          registration_id: registrationId,
          tournament_id: registration.tournament_id,
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Correction resubmitted successfully. Your registration is now under Payment Verification.',
    });
  } catch (err: any) {
    console.error('Correction Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
