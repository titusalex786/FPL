import { z } from 'zod';

export const cricketRolesEnum = z.enum([
  'BATSMAN',
  'BOWLER',
  'ALL_ROUNDER',
  'BATSMAN_WICKETKEEPER',
  'BOWLER_WICKETKEEPER',
]);

export const battingStylesEnum = z.enum(['RIGHT_HAND', 'LEFT_HAND']);
export const jerseySizesEnum = z.enum(['S', 'M', 'L', 'XL', 'XXL', '3XL']);

export const playerProfileSchema = z.object({
  fullName: z
    .string()
    .min(2, 'Full name must be at least 2 characters')
    .max(100, 'Full name must not exceed 100 characters')
    .trim(),
  email: z.string().email('Valid email is required'),
  profileImageUrl: z.string().min(1, 'Please upload your profile photo to complete registration'),
  cricketRole: cricketRolesEnum,
  battingStyle: battingStylesEnum,
  jerseySize: jerseySizesEnum,
  jerseyName: z.string().min(1, 'Jersey name is required').max(30, 'Jersey name must not exceed 30 characters').trim().optional().or(z.literal('')),
  jerseyNumber: z.string().min(1, 'Jersey number is required').max(10, 'Jersey number must not exceed 10 characters').trim().optional().or(z.literal('')),
});

export const tournamentRegistrationSchema = playerProfileSchema.extend({
  jerseyName: z.string().max(30, 'Jersey name must not exceed 30 characters').trim().optional().or(z.literal('')),
  jerseyNumber: z.string().max(10, 'Jersey number must not exceed 10 characters').trim().optional().or(z.literal('')),
  termsAccepted: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the terms and conditions to proceed' }),
  }),
});

export type PlayerProfileInput = z.infer<typeof playerProfileSchema>;
export type TournamentRegistrationInput = z.infer<typeof tournamentRegistrationSchema>;

export interface Step1PersonalInput {
  fullName: string;
  mobile: string;
  email: string;
  dateOfBirth: string;
  city: string;
  profilePhotoPath?: string;
  registrationFor?: 'SELF' | 'OTHER';
}

export interface Step2CricketInput {
  primaryRole: string;
  battingStyle: string;
  bowlingStyle: string;
  experienceLevel?: string;
  jerseyName?: string;
  jerseyNumber?: string;
  jerseySize?: string;
  additionalSkills?: string;
}
