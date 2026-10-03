export type UserRole = 'ADMIN' | 'MANAGER' | 'PLAYER';
export type TournamentType = 'OWNER_BASED' | 'NON_OWNER_BASED';
export type CricketRole = 'BATSMAN' | 'BOWLER' | 'ALL_ROUNDER' | 'BATSMAN_WICKETKEEPER' | 'BOWLER_WICKETKEEPER';
export type BattingStyle = 'RIGHT_HAND' | 'LEFT_HAND';
export type JerseySize = 'S' | 'M' | 'L' | 'XL' | 'XXL' | '3XL';
export type RegistrationStatus = 'CONFIRMED' | 'WAITING_LIST' | 'CANCELLED' | 'PENDING' | 'REJECTED' | 'CORRECTION_REQUESTED';
export type PaymentStatus = 'PENDING' | 'AWAITING_ORGANISER_ACKNOWLEDGEMENT' | 'SUCCESSFUL' | 'FAILED' | 'REFUNDED' | 'CREATED' | 'PROCESSING' | 'CANCELLED';
export type PaymentMethod = 'UPI_QR' | 'UPI' | 'ACKNOWLEDGE_BY_ORGANISER' | 'MANUAL_MOCK';

export interface DbProfile {
  id: string;
  email: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface DbPlayer {
  id: string;
  auth_user_id?: string | null;
  full_name: string;
  email?: string | null;
  profile_image_url?: string | null;
  cricket_role: CricketRole;
  batting_style?: BattingStyle | null;
  bowling_style?: string | null;
  jersey_size?: JerseySize | null;
  jersey_name?: string | null;
  jersey_number?: string | null;
  is_tournament_only?: boolean;
  player_type?: string;
  created_at: string;
  updated_at: string;
}

export interface DbTournament {
  id: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  tournament_date: string;
  registration_fee: number; // Integer in paise (e.g. 50000 = ₹500)
  max_players: number; // Dynamic capacity e.g. 50, 100, 500, 1000
  registration_open: boolean;
  payment_enabled: boolean;
  upi_id: string | null;
  payment_qr_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  contact_email?: string | null;
  contact_phone?: string | null;
  tournament_type?: TournamentType;
  max_teams?: number;
  owner_registration_fee?: number; // Integer in paise
  waitlist_enabled?: boolean;
  banner_url?: string | null;
  registration_end_date?: string | null;
  icon_player_enabled?: boolean;
  owner_is_playing_enabled?: boolean;
}

export interface DbTeamOwner {
  id: string;
  tournament_id: string;
  player_id?: string | null;
  owner_name: string;
  contact_email: string;
  contact_phone: string | null;
  slot_number: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  payment_status: PaymentStatus;
  payment_screenshot_url?: string | null;
  team_name?: string | null;
  team_logo_url?: string | null;
  owner_registration_id?: string | null;
  icon_registration_id?: string | null;
  owner_is_playing?: boolean;
  owner_cricket_role?: string | null;
  icon_player_name?: string | null;
  icon_player_mobile?: string | null;
  icon_player_role?: string | null;
  icon_player_batting_style?: string | null;
  icon_player_bowling_style?: string | null;
  created_by_auth_id?: string | null;
  registered_at: string;
}

export interface DbManager {
  id: string;
  granted_by: string | null;
  user_email: string;
  user_id: string | null;
  display_name: string | null;
  granted_at: string;
  is_active: boolean;
}

export interface DbRegistration {
  id: string;
  tournament_id: string;
  player_id: string;
  registration_number: string;
  registration_status: RegistrationStatus;
  registration_type?: 'PLAYER' | 'OWNER' | 'ICON' | 'REGULAR' | 'TEAM_OWNER' | 'ICON_PLAYER';
  team_name?: string | null;
  team_owner_id?: string | null;
  waitlist_position: number | null;
  created_by_auth_id?: string | null;
  registered_name_snapshot: string;
  registered_role_snapshot: CricketRole;
  registered_batting_style_snapshot: BattingStyle | null;
  registered_bowling_style_snapshot?: string | null;
  registered_jersey_size_snapshot: JerseySize | null;
  registered_jersey_name_snapshot?: string | null;
  registered_jersey_number_snapshot?: string | null;
  registered_image_snapshot: string;
  admin_remarks?: string | null;
  correction_history?: Array<{
    remark: string;
    requested_at: string;
    resolved_at?: string | null;
    resolved_by_auth_id?: string | null;
    [key: string]: any;
  }> | null;
  resubmission_count?: number;
  correction_requested_at?: string | null;
  registered_at: string;
  updated_at: string;
}

export interface DbPayment {
  id: string;
  registration_id: string;
  amount: number; // Integer in paise
  payment_method: PaymentMethod | string;
  payment_status: PaymentStatus;
  transaction_reference: string | null;
  payment_screenshot_url?: string | null;
  screenshot_bucket?: string | null;
  screenshot_object_path?: string | null;
  screenshot_uploaded_at?: string | null;
  extracted_txn_id?: string | null;
  verification_note: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export type NotificationType = 'CORRECTION_REQUIRED' | 'REGISTRATION_CONFIRMED' | 'REGISTRATION_REJECTED' | string;

export interface DbNotification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  registration_id?: string | null;
  tournament_id?: string | null;
  payment_id?: string | null;
  read_at?: string | null;
  created_at: string;
  updated_at: string;
}
