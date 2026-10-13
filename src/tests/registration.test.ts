import { describe, it, expect } from 'vitest';
import {
  playerCricketDetailsSchema,
  playerProfileSchema,
  tournamentRegistrationSchema,
} from '@/lib/validation/registration';
import { generateRegistrationReference, formatPaiseToINR } from '@/lib/utils/format';

describe('Player Profile & Tournament Registration Schemas', () => {
  it('should validate player profile inputs', () => {
    const validProfile = playerProfileSchema.safeParse({
      fullName: 'Rahul Patil',
      email: 'rahul.patil@example.com',
      profileImageUrl: 'https://example.com/avatar.jpg',
      cricketRole: 'BATSMAN',
      battingStyle: 'RIGHT_HAND',
      jerseySize: 'M',
    });
    expect(validProfile.success).toBe(true);

    const invalidProfile = playerProfileSchema.safeParse({
      fullName: 'R',
      email: 'invalid-email',
      profileImageUrl: '',
      cricketRole: 'BATSMAN',
    });
    expect(invalidProfile.success).toBe(false);
  });

  it('should generate a valid non-sequential Registration Reference ID', () => {
    const ref = generateRegistrationReference(2026);
    expect(ref).toMatch(/^REG-2026-\d{5}$/);
  });

  it('should accurately format integer paise into INR currency', () => {
    expect(formatPaiseToINR(50000)).toBe('₹500');
    expect(formatPaiseToINR(75050, true)).toBe('₹750.50');
  });

  it.each([
    'RIGHT_ARM_FAST',
    'RIGHT_ARM_MEDIUM',
    'RIGHT_ARM_SPIN',
    'LEFT_ARM_FAST',
    'LEFT_ARM_MEDIUM',
    'LEFT_ARM_SPIN',
  ])('should accept %s as a bowling style without treating it as batting style', (bowlingStyle) => {
    expect(playerCricketDetailsSchema.safeParse({
      cricketRole: 'ALL_ROUNDER',
      battingStyle: 'RIGHT_HAND',
      bowlingStyle,
    }).success).toBe(true);
  });

  it('should accept left-hand batting and no bowling for a non-bowling role', () => {
    expect(playerCricketDetailsSchema.safeParse({
      cricketRole: 'BATSMAN',
      battingStyle: 'LEFT_HAND',
      bowlingStyle: 'DOESNT_BOWL',
    }).success).toBe(true);
  });

  it('should reject a bowling value submitted as batting style with a field-specific issue', () => {
    const result = playerCricketDetailsSchema.safeParse({
      cricketRole: 'BOWLER',
      battingStyle: 'RIGHT_ARM_FAST',
      bowlingStyle: 'RIGHT_ARM_FAST',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'battingStyle')).toBe(true);
    }
  });

  it('requires a bowling style for bowler and all-rounder roles, but not for batsmen', () => {
    for (const cricketRole of ['BOWLER', 'ALL_ROUNDER', 'BOWLER_WICKETKEEPER']) {
      expect(playerCricketDetailsSchema.safeParse({
        cricketRole,
        battingStyle: 'RIGHT_HAND',
        bowlingStyle: null,
      }).success).toBe(false);
    }

    expect(playerCricketDetailsSchema.safeParse({
      cricketRole: 'BATSMAN_WICKETKEEPER',
      battingStyle: 'RIGHT_HAND',
      bowlingStyle: null,
    }).success).toBe(true);
  });

  it('should validate full tournament registration with terms acceptance', () => {
    const validReg = tournamentRegistrationSchema.safeParse({
      fullName: 'Rahul Patil',
      email: 'rahul.patil@example.com',
      profileImageUrl: 'https://example.com/avatar.jpg',
      cricketRole: 'ALL_ROUNDER',
      battingStyle: 'RIGHT_HAND',
      bowlingStyle: 'RIGHT_ARM_FAST',
      jerseySize: 'L',
      termsAccepted: true,
    });
    expect(validReg.success).toBe(true);

    const missingTerms = tournamentRegistrationSchema.safeParse({
      fullName: 'Rahul Patil',
      email: 'rahul.patil@example.com',
      profileImageUrl: 'https://example.com/avatar.jpg',
      cricketRole: 'ALL_ROUNDER',
      termsAccepted: false,
    });
    expect(missingTerms.success).toBe(false);
  });
});
