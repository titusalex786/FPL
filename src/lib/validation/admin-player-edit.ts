import { z } from 'zod';
import { cricketRolesEnum, battingStylesEnum, jerseySizesEnum } from '@/lib/validation/registration';

export const bowlingStylesEnum = z.enum([
  'RIGHT_ARM_FAST',
  'RIGHT_ARM_MEDIUM',
  'RIGHT_ARM_SPIN',
  'LEFT_ARM_FAST',
  'LEFT_ARM_MEDIUM',
  'LEFT_ARM_SPIN',
  'DOESNT_BOWL',
  'NONE',
]);

export const PROTECTED_FIELDS = [
  'id',
  'player_id',
  'playerId',
  'auth_user_id',
  'authUserId',
  'email',
  'created_at',
  'createdAt',
  'updated_at',
  'updatedAt',
  'created_by',
  'created_by_auth_id',
  'createdBy',
  'registration_number',
  'registrationNumber',
  'registration_status',
  'registrationStatus',
  'payment_status',
  'paymentStatus',
  'payment_id',
  'paymentId',
  'amount',
  'payment_method',
  'paymentMethod',
  'transaction_reference',
  'payment_screenshot_url',
  'team_owner_id',
  'teamOwnerId',
  'owner_slot',
  'player_slot',
  'slot_number',
  'slotNumber',
  'tournament_id',
  'tournamentId',
  'tournament_name',
  'is_tournament_only',
  'player_type',
  'registered_name_snapshot',
  'registered_image_snapshot',
  'registered_role_snapshot',
  'registered_batting_style_snapshot',
  'registered_bowling_style_snapshot',
  'registered_jersey_name_snapshot',
  'registered_jersey_number_snapshot',
  'registered_jersey_size_snapshot',
  'registered_mobile_snapshot',
] as const;

export const adminEditPlayerProfileSchema = z.object({
  fullName: z
    .string()
    .min(2, 'Full name must be at least 2 characters')
    .max(100, 'Full name must not exceed 100 characters')
    .trim()
    .optional(),
  full_name: z
    .string()
    .min(2, 'Full name must be at least 2 characters')
    .max(100, 'Full name must not exceed 100 characters')
    .trim()
    .optional(),
  mobile: z
    .string()
    .trim()
    .refine(
      (val) => !val || /^[6-9]\d{9}$/.test(val.replace(/\s+|-|\+91/g, '')),
      'Mobile number must be a valid 10-digit Indian phone number'
    )
    .nullable()
    .optional(),
  profileImageUrl: z.string().trim().nullable().optional(),
  profile_image_url: z.string().trim().nullable().optional(),
  cricketRole: cricketRolesEnum.optional(),
  cricket_role: cricketRolesEnum.optional(),
  battingStyle: battingStylesEnum.nullable().optional(),
  batting_style: battingStylesEnum.nullable().optional(),
  bowlingStyle: bowlingStylesEnum.nullable().optional(),
  bowling_style: bowlingStylesEnum.nullable().optional(),
  jerseyName: z
    .string()
    .max(30, 'Jersey name must not exceed 30 characters')
    .trim()
    .nullable()
    .optional(),
  jersey_name: z
    .string()
    .max(30, 'Jersey name must not exceed 30 characters')
    .trim()
    .nullable()
    .optional(),
  jerseyNumber: z
    .string()
    .trim()
    .refine(
      (val) => !val || /^[0-9]{1,3}$/.test(val),
      'Jersey number must be 1 to 3 digits (0-999)'
    )
    .nullable()
    .optional(),
  jersey_number: z
    .string()
    .trim()
    .refine(
      (val) => !val || /^[0-9]{1,3}$/.test(val),
      'Jersey number must be 1 to 3 digits (0-999)'
    )
    .nullable()
    .optional(),
  jerseySize: jerseySizesEnum.nullable().optional(),
  jersey_size: jerseySizesEnum.nullable().optional(),
  editReason: z
    .string()
    .min(5, 'Edit reason must be at least 5 characters')
    .max(500, 'Edit reason must not exceed 500 characters')
    .trim()
    .optional(),
  edit_reason: z
    .string()
    .min(5, 'Edit reason must be at least 5 characters')
    .max(500, 'Edit reason must not exceed 500 characters')
    .trim()
    .optional(),
  reason: z
    .string()
    .min(5, 'Edit reason must be at least 5 characters')
    .max(500, 'Edit reason must not exceed 500 characters')
    .trim()
    .optional(),
});

export type AdminEditPlayerProfileInput = z.infer<typeof adminEditPlayerProfileSchema>;

