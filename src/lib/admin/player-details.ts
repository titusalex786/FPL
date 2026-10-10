import { createAdminClient } from '@/lib/supabase/admin';
import { getSignedScreenshotUrl, resolveImageUrl } from '@/lib/storage/upload';
import { computeDerivedRegistrationStatus, DerivedStatusInfo } from '@/lib/utils/derived-status';

export interface PlayerProfileDTO {
  id: string;
  full_name: string;
  email: string;
  mobile: string | null;
  profile_image_url: string | null;
  cricket_role: string;
  batting_style: string | null;
  bowling_style: string | null;
  jersey_name: string | null;
  jersey_number: string | null;
  jersey_size: string | null;
  created_at: string;
}

export interface TeamOwnerDTO {
  team_name: string;
  team_logo_url: string | null;
  slot_number: number;
  owner_name: string;
  contact_email: string;
  contact_phone?: string | null;
}

export interface PaymentDetailsDTO {
  id: string;
  amount: number;
  payment_status: string;
  payment_method: string | null;
  transaction_reference: string | null;
  payment_date: string | null;
  payment_screenshot_url: string | null;
  verification_note: string | null;
}

export interface CorrectionHistoryDTO {
  requested_date: string | null;
  remark: string | null;
  submitted_date: string | null;
  resolved_date: string | null;
  resolved_by: string | null;
  changed_fields: string[];
  previous_values: Record<string, any>;
  new_values: Record<string, any>;
  resubmission_count: number | null;
}

export interface TournamentRegistrationDTO {
  id: string;
  tournament_id: string;
  tournament_name: string;
  tournament_date: string | null;
  registration_number: string;
  registration_type: 'PLAYER' | 'OWNER' | 'ICON';
  registered_name: string;
  registered_profile_image: string | null;
  registered_cricket_role: string;
  registered_batting_style: string | null;
  registered_bowling_style: string | null;
  registered_jersey_name: string | null;
  registered_jersey_number: string | null;
  registered_jersey_size: string | null;
  registration_date: string;
  registration_status: string;
  derived_status: DerivedStatusInfo;
  admin_remark: string | null;
  team_owner: TeamOwnerDTO | null;
  payment: PaymentDetailsDTO | null;
  correction_history: CorrectionHistoryDTO[];
}

export interface AdminPlayerDetailsResponse {
  player: PlayerProfileDTO;
  registrations: TournamentRegistrationDTO[];
  selectedRegistrationId: string | null;
}

/**
 * Fetch complete, read-only player details and registrations for admin inspection.
 * @param entityId Either a player_id or registration_id
 * @param preferredRegistrationId Optional registration_id to select as active
 */
export async function getAdminPlayerDetails(
  entityId: string,
  preferredRegistrationId?: string | null
): Promise<AdminPlayerDetailsResponse | null> {
  const adminClient = createAdminClient();

  let targetPlayerId: string | null = null;
  let targetRegistrationId: string | null = preferredRegistrationId || null;

  // 1. Check if entityId matches a player profile
  const { data: playerRecord } = await adminClient
    .from('players')
    .select(`
      id,
      full_name,
      email,
      mobile,
      profile_image_url,
      cricket_role,
      batting_style,
      bowling_style,
      jersey_name,
      jersey_number,
      jersey_size,
      created_at
    `)
    .eq('id', entityId)
    .maybeSingle();

  if (playerRecord) {
    targetPlayerId = playerRecord.id;
  } else {
    // 2. Check if entityId is a registration_id
    const { data: regLookup } = await adminClient
      .from('registrations')
      .select('id, player_id')
      .eq('id', entityId)
      .maybeSingle();

    if (!regLookup || !regLookup.player_id) {
      return null;
    }

    targetPlayerId = regLookup.player_id;
    if (!targetRegistrationId) {
      targetRegistrationId = regLookup.id;
    }
  }

  // Fetch full player record if not already loaded
  const player = playerRecord || (
    await adminClient
      .from('players')
      .select(`
        id,
        full_name,
        email,
        mobile,
        profile_image_url,
        cricket_role,
        batting_style,
        bowling_style,
        jersey_name,
        jersey_number,
        jersey_size,
        created_at
      `)
      .eq('id', targetPlayerId)
      .maybeSingle()
  ).data;

  if (!player) {
    return null;
  }

  // 3. Fetch all registrations for this player
  const { data: registrationsData } = await adminClient
    .from('registrations')
    .select(`
      id,
      tournament_id,
      player_id,
      registration_number,
      registration_status,
      registration_type,
      team_name,
      team_owner_id,
      waitlist_position,
      registered_name_snapshot,
      registered_image_snapshot,
      registered_role_snapshot,
      registered_batting_style_snapshot,
      registered_bowling_style_snapshot,
      registered_jersey_size_snapshot,
      registered_jersey_name_snapshot,
      registered_jersey_number_snapshot,
      correction_history,
      registered_at,
      tournament:tournaments (
        id,
        name,
        tournament_date,
        registration_fee,
        payment_enabled
      ),
      payments:payments (
        id,
        amount,
        payment_status,
        payment_method,
        transaction_reference,
        payment_screenshot_url,
        screenshot_object_path,
        screenshot_bucket,
        verification_note,
        created_at
      )
    `)
    .eq('player_id', targetPlayerId)
    .order('registered_at', { ascending: false });

  const rawRegistrations = registrationsData || [];

  // 4. Batch lookup team_owners for any registrations referencing team_owner_id
  const teamOwnerIds = Array.from(
    new Set(rawRegistrations.map((r: any) => r.team_owner_id).filter(Boolean))
  );

  let teamOwnersMap: Record<string, TeamOwnerDTO> = {};
  if (teamOwnerIds.length > 0) {
    const { data: owners } = await adminClient
      .from('team_owners')
      .select('id, team_name, team_logo_url, slot_number, owner_name, contact_email, contact_phone')
      .in('id', teamOwnerIds);

    (owners || []).forEach((o: any) => {
      teamOwnersMap[o.id] = {
        team_name: o.team_name,
        team_logo_url: o.team_logo_url ? resolveImageUrl(o.team_logo_url, 'team-logos') : null,
        slot_number: o.slot_number,
        owner_name: o.owner_name,
        contact_email: o.contact_email,
        contact_phone: o.contact_phone || null,
      };
    });
  }

  // 5. Process registrations into safe DTOs
  const processedRegistrations: TournamentRegistrationDTO[] = await Promise.all(
    rawRegistrations.map(async (reg: any) => {
      const paymentsList = Array.isArray(reg.payments) ? reg.payments : reg.payments ? [reg.payments] : [];
      const primaryPayment = paymentsList[0] || null;

      let signedScreenshotUrl: string | null = null;
      if (primaryPayment) {
        if (primaryPayment.screenshot_object_path) {
          try {
            signedScreenshotUrl = await getSignedScreenshotUrl(
              primaryPayment.screenshot_bucket || 'payment-screenshots',
              primaryPayment.screenshot_object_path,
              900
            );
          } catch {
            signedScreenshotUrl = primaryPayment.payment_screenshot_url || null;
          }
        } else if (primaryPayment.payment_screenshot_url) {
          signedScreenshotUrl = primaryPayment.payment_screenshot_url;
        }
      }

      // Safe Payment DTO (never exposing internal storage paths or service metadata)
      const paymentDTO: PaymentDetailsDTO | null = primaryPayment
        ? {
            id: primaryPayment.id,
            amount: primaryPayment.amount,
            payment_status: primaryPayment.payment_status,
            payment_method: primaryPayment.payment_method || null,
            transaction_reference: primaryPayment.transaction_reference || null,
            payment_date: primaryPayment.created_at || null,
            payment_screenshot_url: signedScreenshotUrl,
            verification_note: primaryPayment.verification_note || null,
          }
        : null;

      // Immutable Correction History DTO
      const rawHistory = Array.isArray(reg.correction_history) ? reg.correction_history : [];
      const correctionHistoryDTO: CorrectionHistoryDTO[] = rawHistory.map((c: any) => ({
        requested_date: c.requested_date || c.requested_at || null,
        remark: c.remark || c.admin_remark || c.original_remark || null,
        submitted_date: c.submitted_date || c.submitted_at || null,
        resolved_date: c.resolved_date || c.resolved_at || null,
        resolved_by: c.resolved_by || c.resolved_by_admin || c.resolved_by_auth_id || null,
        changed_fields: Array.isArray(c.changed_fields) ? c.changed_fields : [],
        previous_values: typeof c.previous_values === 'object' && c.previous_values ? c.previous_values : {},
        new_values: typeof c.new_values === 'object' && c.new_values ? c.new_values : {},
        resubmission_count: typeof c.resubmission_count === 'number' ? c.resubmission_count : null,
      }));

      // Derived Status computation
      const derivedStatus = computeDerivedRegistrationStatus(
        reg,
        primaryPayment,
        reg.tournament
      );

      // Team Owner relationship for OWNER and ICON registrations
      let teamOwnerDTO: TeamOwnerDTO | null = null;
      if (reg.team_owner_id && teamOwnersMap[reg.team_owner_id]) {
        teamOwnerDTO = teamOwnersMap[reg.team_owner_id];
      } else if (reg.team_name) {
        teamOwnerDTO = {
          team_name: reg.team_name,
          team_logo_url: null,
          slot_number: 0,
          owner_name: reg.registered_name_snapshot,
          contact_email: player.email,
        };
      }

      const adminRemark = primaryPayment?.verification_note || correctionHistoryDTO[0]?.remark || null;

      return {
        id: reg.id,
        tournament_id: reg.tournament_id,
        tournament_name: reg.tournament?.name || 'FairPlay Premier League',
        tournament_date: reg.tournament?.tournament_date || null,
        registration_number: reg.registration_number,
        registration_type: (reg.registration_type || 'PLAYER') as 'PLAYER' | 'OWNER' | 'ICON',
        registered_name: reg.registered_name_snapshot || player.full_name,
        registered_profile_image: reg.registered_image_snapshot
          ? resolveImageUrl(reg.registered_image_snapshot, 'profile-images')
          : null,
        registered_cricket_role: reg.registered_role_snapshot || player.cricket_role,
        registered_batting_style: reg.registered_batting_style_snapshot || player.batting_style,
        registered_bowling_style: reg.registered_bowling_style_snapshot || player.bowling_style,
        registered_jersey_name: reg.registered_jersey_name_snapshot || player.jersey_name,
        registered_jersey_number: reg.registered_jersey_number_snapshot || player.jersey_number,
        registered_jersey_size: reg.registered_jersey_size_snapshot || player.jersey_size,
        registration_date: reg.registered_at,
        registration_status: reg.registration_status,
        derived_status: derivedStatus,
        admin_remark: adminRemark,
        team_owner: teamOwnerDTO,
        payment: paymentDTO,
        correction_history: correctionHistoryDTO,
      };
    })
  );

  const playerProfileDTO: PlayerProfileDTO = {
    id: player.id,
    full_name: player.full_name,
    email: player.email,
    mobile: player.mobile || null,
    profile_image_url: player.profile_image_url
      ? resolveImageUrl(player.profile_image_url, 'profile-images')
      : null,
    cricket_role: player.cricket_role,
    batting_style: player.batting_style || null,
    bowling_style: player.bowling_style || null,
    jersey_name: player.jersey_name || null,
    jersey_number: player.jersey_number || null,
    jersey_size: player.jersey_size || null,
    created_at: player.created_at,
  };

  const selectedId =
    targetRegistrationId && processedRegistrations.some((r) => r.id === targetRegistrationId)
      ? targetRegistrationId
      : processedRegistrations[0]?.id || null;

  return {
    player: playerProfileDTO,
    registrations: processedRegistrations,
    selectedRegistrationId: selectedId,
  };
}
