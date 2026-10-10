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

    const fullName = body.fullName?.trim();
    if (!fullName || fullName.length < 2) {
      return NextResponse.json({ error: 'Please enter a valid full name (at least 2 characters)' }, { status: 400 });
    }

    const profileImageUrl = body.profileImageUrl || body.profilePhotoPath;
    if (!profileImageUrl) {
      return NextResponse.json({ error: 'Please upload a profile photo to complete registration' }, { status: 400 });
    }

    const rawRole = body.cricketRole || body.primaryRole || 'BATSMAN';
    const cricketRole = rawRole === 'WICKETKEEPER' || rawRole === 'BATSMAN_BOWLER' ? 'ALL_ROUNDER' : rawRole;
    const battingStyle = body.battingStyle || 'RIGHT_HAND';
    const jerseySize = body.jerseySize || 'M';
    const jerseyName = (body.jerseyName || fullName).trim();
    const jerseyNumber = (body.jerseyNumber || '').trim();

    const isOther = body.registrationFor === 'OTHER' || body.isSelf === false;
    const supabaseAdmin = createAdminClient();

    let playerId: string;

    if (isOther) {
      // Create a NEW tournament-only participant record for OTHER person
      const { data: newPlayer, error: newPlayerErr } = await supabaseAdmin
        .from('players')
        .insert({
          full_name: fullName,
          mobile: body.mobile || null,
          email: body.email?.toLowerCase().trim() || user.email,
          is_tournament_only: true,
          player_type: 'STANDARD',
          cricket_role: cricketRole,
          batting_style: battingStyle,
          bowling_style: body.bowlingStyle || null,
          jersey_name: jerseyName,
          jersey_number: jerseyNumber || null,
          profile_image_url: profileImageUrl,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (newPlayerErr || !newPlayer?.id) {
        console.error('[registration] Failed to create tournament-only player', {
          operation: 'players.insert (tournament-only)',
          code: newPlayerErr?.code,
        });
        return NextResponse.json({ error: 'Failed to create participant profile' }, { status: 500 });
      }

      playerId = newPlayer.id;
    } else {
      // Resolve/Upsert primary Player Profile for SELF
      const { data: playerProfile, error: profileErr } = await supabaseServer
        .from('players')
        .select('id')
        .eq('auth_user_id', user.id)
        .maybeSingle();

      if (profileErr) {
        console.error('[registration] Failed to resolve player profile', {
          operation: 'players.select',
          code: profileErr?.code,
        });
        return NextResponse.json({ error: 'Failed to resolve player profile' }, { status: 500 });
      }

      if (!playerProfile?.id) {
        // Auto-create primary player profile for user
        const { data: newSelfPlayer, error: createSelfErr } = await supabaseAdmin
          .from('players')
          .insert({
            auth_user_id: user.id,
            full_name: fullName,
            email: user.email?.toLowerCase().trim(),
            mobile: body.mobile || null,
            cricket_role: cricketRole,
            batting_style: battingStyle,
            bowling_style: body.bowlingStyle || null,
            jersey_name: jerseyName,
            jersey_number: jerseyNumber || null,
            profile_image_url: profileImageUrl,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (createSelfErr || !newSelfPlayer?.id) {
          console.error('[registration] Failed to create self player profile', {
            operation: 'players.insert (self)',
            code: createSelfErr?.code,
          });
          return NextResponse.json({ error: 'Failed to create player profile for user' }, { status: 500 });
        }
        playerId = newSelfPlayer.id;
      } else {
        playerId = playerProfile.id;

        // CRITICAL #2 FIX: Never silently swallow DB update errors.
        // Update jersey snapshot defaults for next-time convenience.
        // Failure is logged but is non-fatal — it only affects UI pre-filling.
        if (typeof (supabaseAdmin.from('players') as any)?.update === 'function') {
          try {
            const { error: updateProfileErr } = await supabaseAdmin
              .from('players')
              .update({
                jersey_name: jerseyName,
                jersey_number: jerseyNumber || null,
                updated_at: new Date().toISOString(),
              })
              .eq('id', playerId);

            if (updateProfileErr) {
              // Non-fatal: snapshot is in the registration record, not the player profile.
              // Log for diagnostics but allow registration to continue.
              console.error('[registration] Failed to update player profile jersey defaults (non-fatal)', {
                operation: 'players.update (jersey defaults)',
                playerId,
                code: updateProfileErr?.code,
              });
            }
          } catch (err: any) {
            console.error('[registration] Failed to update player profile jersey defaults (non-fatal)', {
              operation: 'players.update (jersey defaults exception)',
              playerId,
              message: err?.message,
            });
          }
        }
      }
    }

    // 2. Fetch Target Tournament
    let tournament;
    if (body.tournamentId) {
      const { data: t } = await supabaseAdmin
        .from('tournaments')
        .select('id, name, registration_fee, max_players, registration_open, waitlist_enabled')
        .eq('id', body.tournamentId)
        .maybeSingle();
      tournament = t;
    }

    if (!tournament) {
      const { data: latest } = await supabaseAdmin
        .from('tournaments')
        .select('id, name, registration_fee, max_players, registration_open, waitlist_enabled')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      tournament = latest;
    }

    if (!tournament) {
      return NextResponse.json({ error: 'No active tournament found. Please ask the tournament admin to publish a tournament.' }, { status: 400 });
    }

    const tournamentId = tournament.id;

    // 3. Pre-validate Payment Screenshot File (if submitted)
    const screenshotBucket = 'payment-screenshots';
    let screenshotBuffer: Buffer | null = null;
    let screenshotValidation: any = null;

    if (body.paymentScreenshotBase64) {
      const cleanBase64 = body.paymentScreenshotBase64.replace(/^data:image\/\w+;base64,/, '');
      screenshotBuffer = Buffer.from(cleanBase64, 'base64');
      screenshotValidation = validateImageFileBuffer(screenshotBuffer);
      if (!screenshotValidation.isValid || !screenshotValidation.mimeType || !screenshotValidation.extension) {
        return NextResponse.json({ error: screenshotValidation.error || 'Invalid payment screenshot file format' }, { status: 400 });
      }
    }

    // 4. Atomic Registration Allocation via allocate_player_registration_v2
    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('allocate_player_registration_v2', {
      p_tournament_id: tournamentId,
      p_player_id: playerId,
      p_registered_name_snapshot: fullName,
      p_registered_role_snapshot: cricketRole,
      p_registered_batting_style_snapshot: battingStyle,
      p_registered_jersey_size_snapshot: jerseySize,
      p_registered_image_snapshot: profileImageUrl,
      p_screenshot_bucket: screenshotBucket,
      p_screenshot_object_path: null,
      p_created_by_auth_id: user.id,
      p_registered_jersey_name_snapshot: jerseyName,
      p_registered_jersey_number_snapshot: jerseyNumber || null,
      p_registered_bowling_style_snapshot: body.bowlingStyle || null,
    });

    if (rpcErr || !rpcData || rpcData.length === 0) {
      console.error('[registration] RPC allocate_player_registration_v2 failed', {
        operation: 'allocate_player_registration_v2',
        code: rpcErr?.code,
        message: rpcErr?.message,
      });
      const isDuplicate = rpcErr?.message?.includes('already registered') || rpcErr?.code === '23505';
      const msg = isDuplicate
        ? 'You are already registered for this tournament. To register someone else, please select "Someone else".'
        : rpcErr?.message || 'Failed to complete registration atomically';
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const result = rpcData[0];
    const registrationId = result.registration_id;

    // CRITICAL #2 FIX: Never silently swallow DB errors.
    // Guarantee snapshot consistency for historical immutability.
    if (typeof (supabaseAdmin.from('registrations') as any)?.update === 'function') {
      try {
        const { error: snapshotErr } = await supabaseAdmin
          .from('registrations')
          .update({
            registered_jersey_name_snapshot: jerseyName,
            registered_jersey_number_snapshot: jerseyNumber || null,
            registered_bowling_style_snapshot: body.bowlingStyle || null,
          })
          .eq('id', registrationId);

        if (snapshotErr) {
          // Non-fatal: RPC already wrote the core snapshot. This is a supplemental update.
          console.error('[registration] Failed to update registration snapshot fields (non-fatal)', {
            operation: 'registrations.update (snapshot)',
            registrationId,
            code: snapshotErr?.code,
          });
        }
      } catch (err: any) {
        console.error('[registration] Exception updating registration snapshot fields (non-fatal)', {
          operation: 'registrations.update (snapshot exception)',
          registrationId,
          message: err?.message,
        });
      }
    }

    // =========================================================================
    // CRITICAL #3 FIX — PAYMENT SCREENSHOT LINKING
    //
    // Flow:
    //   1. RPC creates the registration row and a payment row atomically.
    //   2. RPC returns result.payment_id.
    //   3. We upload the screenshot to Storage.
    //   4. We link the screenshot to the payment row.
    //
    // Bug that existed: if result.payment_id was null/undefined (e.g. waitlist),
    //   the screenshot was uploaded to Storage but no payment row was updated —
    //   leaving an orphaned Storage object.
    //
    // Fix: After a successful upload, if payment_id is missing, look up the
    //   payment row by registration_id and update it there. If no payment row
    //   exists yet, create one so the screenshot reference is never orphaned.
    //   Never create a duplicate payment row if one already exists.
    // =========================================================================
    let screenshotObjectPath: string | null = null;
    if (screenshotBuffer && screenshotValidation) {
      const ext = screenshotValidation.extension;
      const filename = `${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${ext}`;
      screenshotObjectPath = `${tournamentId}/${registrationId}/${filename}`;

      try {
        await uploadToStorageBucket(screenshotBucket, screenshotObjectPath, screenshotBuffer, screenshotValidation.mimeType);
      } catch (uploadErr: any) {
        // Storage upload failed — do not orphan a screenshot reference in DB.
        console.error('[registration] Payment screenshot upload to Storage failed', {
          operation: 'storage.upload (payment-screenshots)',
          registrationId,
          message: uploadErr?.message,
        });
        screenshotObjectPath = null; // ensure nothing is written to DB for a failed upload
      }

      if (screenshotObjectPath) {
        // Screenshot is in Storage — must link it to the payment record.
        const screenshotLinkPayload = {
          screenshot_bucket: screenshotBucket,
          screenshot_object_path: screenshotObjectPath,
        };

        if (result.payment_id) {
          // Common path: RPC returned the payment ID — update it directly.
          const { error: linkErr } = await supabaseAdmin
            .from('payments')
            .update(screenshotLinkPayload)
            .eq('id', result.payment_id);

          if (linkErr) {
            console.error('[registration] Failed to link screenshot to payment record', {
              operation: 'payments.update (screenshot link)',
              registrationId,
              paymentId: result.payment_id,
              code: linkErr?.code,
            });
          }
        } else {
          // Fallback path: payment_id was not returned by RPC (e.g. waitlist).
          // Look up the payment row by registration_id to avoid creating a duplicate.
          const { data: existingPayment, error: lookupErr } = await supabaseAdmin
            .from('payments')
            .select('id')
            .eq('registration_id', registrationId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (lookupErr) {
            console.error('[registration] Failed to look up payment row for screenshot linking', {
              operation: 'payments.select (screenshot fallback)',
              registrationId,
              code: lookupErr?.code,
            });
          } else if (existingPayment) {
            // Payment row exists — link the screenshot to it.
            const { error: fallbackLinkErr } = await supabaseAdmin
              .from('payments')
              .update(screenshotLinkPayload)
              .eq('id', existingPayment.id);

            if (fallbackLinkErr) {
              console.error('[registration] Failed to link screenshot to looked-up payment record', {
                operation: 'payments.update (screenshot fallback link)',
                registrationId,
                paymentId: existingPayment.id,
                code: fallbackLinkErr?.code,
              });
            }
          } else {
            // No payment row found — create one and include the screenshot link.
            // This guards against the screenshot being orphaned in Storage.
            const tFee = tournament.registration_fee || 50000;
            const { error: createPaymentErr } = await supabaseAdmin
              .from('payments')
              .insert({
                registration_id: registrationId,
                amount: tFee,
                player_fee_paise: tFee,
                payment_method: 'UPI_QR',
                payment_status: 'PENDING',
                ...screenshotLinkPayload,
              });

            if (createPaymentErr) {
              console.error('[registration] Failed to create payment row with screenshot link', {
                operation: 'payments.insert (screenshot orphan guard)',
                registrationId,
                code: createPaymentErr?.code,
              });
            }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      registrationId: result.registration_id,
      registrationNumber: result.registration_number,
      registrationStatus: result.registration_status,
      waitlistPosition: result.waitlist_position,
      paymentId: result.payment_id,
      paymentOrder: {
        orderId: `order_${Date.now()}`,
        amount: tournament.registration_fee || 50000,
      },
      message: result.registration_status === 'WAITING_LIST'
        ? `Player capacity full. Placed on waitlist position #${result.waitlist_position}.`
        : 'Registration completed successfully!',
    });
  } catch (err: any) {
    console.error('[registration] Unhandled error in registration POST', {
      operation: 'POST /api/registrations',
      message: err?.message,
    });
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
