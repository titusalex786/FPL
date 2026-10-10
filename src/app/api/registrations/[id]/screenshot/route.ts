import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { checkIsAdmin } from '@/lib/auth/is-admin';
import { uploadToStorageBucket, validateImageFileBuffer } from '@/lib/storage/upload';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: registrationId } = await params;

    // Check authentication & session ownership
    const supabaseServer = await createServerSupabaseClient();
    const { data: { user }, error: authErr } = await supabaseServer.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await req.json();
    const { screenshotUrl, screenshotBase64, transactionReference, paymentDate } = body;
    const rawImageInput = screenshotBase64 || (screenshotUrl && screenshotUrl.startsWith('data:image/') ? screenshotUrl : null);

    if (screenshotUrl && (screenshotUrl.startsWith('http://') || screenshotUrl.startsWith('https://')) && !screenshotBase64) {
      return NextResponse.json(
        { error: 'Arbitrary external screenshot URLs are not allowed. Please upload a valid image file (JPEG, PNG, WebP).' },
        { status: 400 }
      );
    }

    if (!rawImageInput) {
      return NextResponse.json(
        { error: 'Please select and upload your payment receipt screenshot image.' },
        { status: 400 }
      );
    }

    const cleanBase64 = rawImageInput.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');

    const validation = validateImageFileBuffer(buffer);
    if (!validation.isValid || !validation.mimeType) {
      return NextResponse.json(
        { error: validation.error || 'Invalid payment screenshot format. Please upload a valid JPG, PNG, or WebP image.' },
        { status: 400 }
      );
    }

    const cleanTxnRef = (transactionReference || '').trim();
    if (cleanTxnRef && cleanTxnRef.length < 6) {
      return NextResponse.json(
        { error: 'Transaction Reference / UPI UTR ID must be at least 6 digits/characters long.' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // 2. Lookup registration record by UUID or registration_number
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(registrationId);
    let regQuery = supabase
      .from('registrations')
      .select('id, tournament_id, player_id, registration_number, registration_type, registered_name_snapshot, created_by_auth_id, player:players(id, auth_user_id, email)');

    if (isUuid) {
      regQuery = regQuery.eq('id', registrationId);
    } else {
      regQuery = regQuery.eq('registration_number', registrationId);
    }

    const { data: registration, error: regError } = await regQuery.maybeSingle();

    if (regError || !registration) {
      return NextResponse.json({ error: 'Registration record not found' }, { status: 404 });
    }

    // 3. Resolve user player profile for ownership check
    const { data: playerProfile } = await supabase
      .from('players')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    // 4. Verify authorization:
    // User is authorized if:
    // a) User is a DB-backed admin or manager
    // b) User created the registration (created_by_auth_id === user.id)
    //    -> covers self-registration, teammate registration ('OTHER'), Owner registration, and Icon registration created by Owner
    // c) Registration player record is linked to user's auth account (player.auth_user_id === user.id)
    // d) Registration player_id matches the user's player profile (playerProfile.id)
    // e) User is the Team Owner associated with this registration's team or slot
    const { isAdmin } = await checkIsAdmin();

    let isAuthorized = isAdmin;

    if (!isAuthorized) {
      const regPlayer = registration.player as any;
      const isCreator = registration.created_by_auth_id === user.id;
      const isLinkedPlayerAuth = regPlayer?.auth_user_id === user.id;
      const isDirectPlayer = Boolean(playerProfile?.id && registration.player_id === playerProfile.id);

      if (isCreator || isLinkedPlayerAuth || isDirectPlayer) {
        isAuthorized = true;
      } else if (
        playerProfile?.id &&
        (registration.registration_type === 'OWNER' || registration.registration_type === 'ICON')
      ) {
        // Check if user is the Team Owner for this Owner or Icon registration
        const { data: ownerSlot } = await supabase
          .from('team_owners')
          .select('id')
          .eq('player_id', playerProfile.id)
          .eq('owner_registration_id', registration.id)
          .maybeSingle();

        const { data: iconSlot } = !ownerSlot
          ? await supabase
              .from('team_owners')
              .select('id')
              .eq('player_id', playerProfile.id)
              .eq('icon_registration_id', registration.id)
              .maybeSingle()
          : { data: null };

        if (ownerSlot || iconSlot) {
          isAuthorized = true;
        }
      }
    }

    if (!isAuthorized) {
      return NextResponse.json({ error: 'You are not authorized to upload a screenshot for this registration' }, { status: 403 });
    }

    // 5. Upload file to private payment-screenshots storage bucket
    const ext = validation.mimeType === 'image/jpeg' ? 'jpg' : validation.mimeType === 'image/webp' ? 'webp' : 'png';
    const screenshotBucket = 'payment-screenshots';
    const screenshotObjectPath = `${registration.tournament_id}/${registration.id}/${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${ext}`;

    await uploadToStorageBucket(screenshotBucket, screenshotObjectPath, buffer, validation.mimeType);

    // 6. Check if existing payment record exists for this registration (using canonical registration.id)
    const { data: existingPayment } = await supabase
      .from('payments')
      .select('id')
      .eq('registration_id', registration.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nowIso = new Date().toISOString();
    const paymentPayload: any = {
      screenshot_bucket: screenshotBucket,
      screenshot_object_path: screenshotObjectPath,
      transaction_reference: cleanTxnRef || `UPI-${Date.now().toString().slice(-8)}`,
      payment_status: 'PENDING',
      verification_note: `1st Step Automated Validation Passed. Awaiting Step 2 Admin Approval.`,
      updated_at: nowIso,
    };

    if (existingPayment) {
      const { error: updateErr } = await supabase
        .from('payments')
        .update(paymentPayload)
        .eq('id', existingPayment.id);
      if (updateErr) {
        // Rollback uploaded storage object to prevent orphans
        await supabase.storage.from(screenshotBucket).remove([screenshotObjectPath]);
        return NextResponse.json({ error: `Failed to update payment record: ${updateErr.message}` }, { status: 500 });
      }
    } else {
      const { data: tournament } = await supabase
        .from('tournaments')
        .select('registration_fee, owner_registration_fee')
        .eq('id', registration.tournament_id)
        .maybeSingle();

      const isOwner = registration.registration_type === 'OWNER';
      const playerFee = tournament?.registration_fee || 50000;
      const ownerFee = isOwner ? (tournament?.owner_registration_fee || 0) : 0;
      const totalAmount = playerFee + ownerFee;

      const { error: insertErr } = await supabase.from('payments').insert({
        registration_id: registration.id,
        amount: totalAmount,
        owner_fee_paise: ownerFee,
        player_fee_paise: playerFee,
        payment_method: 'UPI_QR',
        ...paymentPayload,
      });
      if (insertErr) {
        // Rollback uploaded storage object to prevent orphans
        await supabase.storage.from(screenshotBucket).remove([screenshotObjectPath]);
        return NextResponse.json({ error: `Failed to create payment record: ${insertErr.message}` }, { status: 500 });
      }
    }

    // 7. Ensure registration_status is set to PENDING for admin verification queue
    await supabase
      .from('registrations')
      .update({
        registration_status: 'PENDING',
        status: 'PENDING',
        updated_at: nowIso,
      })
      .eq('id', registration.id);

    // 8. Send confirmation notification to user
    try {
      const { sendNotification } = await import('@/lib/notifications/create-notification');
      await sendNotification({
        userId: user.id,
        type: 'REPLACEMENT_SCREENSHOT_SUBMITTED',
        title: 'Replacement Screenshot Received',
        message: 'Your replacement payment screenshot has been uploaded and queued for admin verification.',
        registrationId: registration.id,
        tournamentId: registration.tournament_id,
      });
    } catch (notifErr: any) {
      console.warn('Notification warning:', notifErr.message);
    }

    return NextResponse.json({
      success: true,
      message: 'Payment screenshot uploaded to secure Storage and validated successfully!',
      registrationId: registration.id,
      screenshotBucket,
      screenshotObjectPath,
    });
  } catch (err: any) {
    console.error('Screenshot upload API error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
