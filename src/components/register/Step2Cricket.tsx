'use client';

import React, { useState } from 'react';
import { Step2CricketInput } from '@/lib/validation/registration';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { JerseyInfoTooltip } from '@/components/ui/JerseyInfoTooltip';
import { Button } from '@/components/ui/Button';
import { PlayingRole, BattingStyle, BowlingStyle, ExperienceLevel } from '@/types';
import { Shield, ArrowRight, ArrowLeft } from 'lucide-react';

export interface Step2Props {
  initialData: Step2CricketInput;
  onNext: (data: Step2CricketInput) => void;
  onBack: () => void;
}

export const Step2Cricket: React.FC<Step2Props> = ({ initialData, onNext, onBack }) => {
  const [formData, setFormData] = useState<Step2CricketInput>(initialData);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleRoleChange = (role: PlayingRole) => {
    setFormData((prev) => {
      const updated: Step2CricketInput = { ...prev, primaryRole: role };
      // Conditional logic: if Doesn't Bowl or Batsman/Wicketkeeper only, set bowlingStyle accordingly
      if (role === 'BATSMAN' || role === 'WICKETKEEPER') {
        updated.bowlingStyle = 'DOESNT_BOWL';
      }
      return updated;
    });

    if (errors.primaryRole || errors.bowlingStyle) {
      setErrors((prev) => {
        const copy = { ...prev };
        delete copy.primaryRole;
        delete copy.bowlingStyle;
        return copy;
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!formData.primaryRole) {
      newErrors.primaryRole = 'Please select your primary playing role';
    }

    if (
      (formData.primaryRole === 'BOWLER' ||
        formData.primaryRole === 'BATSMAN_BOWLER' ||
        formData.primaryRole === 'ALL_ROUNDER') &&
      (!formData.bowlingStyle || formData.bowlingStyle === 'DOESNT_BOWL')
    ) {
      newErrors.bowlingStyle = 'Please select your bowling style for this role';
    }

    if (!formData.jerseyName || !formData.jerseyName.trim()) {
      newErrors.jerseyName = 'Jersey name is required';
    }

    if (!formData.jerseyNumber || !formData.jerseyNumber.trim()) {
      newErrors.jerseyNumber = 'Jersey number is required';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onNext(formData);
  };

  const isBowlingDisabled =
    formData.primaryRole === 'BATSMAN' ||
    formData.primaryRole === 'WICKETKEEPER' ||
    formData.bowlingStyle === 'DOESNT_BOWL';

  return (
    <form onSubmit={handleSubmit} className="space-y-6 animate-fadeIn">
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 md:p-8 space-y-6 shadow-xl">
        <div className="border-b border-slate-800 pb-4">
          <h2 className="text-lg md:text-xl font-bold text-slate-100 flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-400" />
            <span>Step 2: Cricket Information</span>
          </h2>
          <p className="text-xs md:text-sm text-slate-400 mt-1">
            Specify your playing role, batting style, bowling style, and jersey specifications.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {/* Primary Role */}
          <div className="md:col-span-2">
            <Select
              label="Primary Playing Role"
              required
              value={formData.primaryRole || 'BATSMAN'}
              onChange={(e) => handleRoleChange(e.target.value as PlayingRole)}
              error={errors.primaryRole}
              options={[
                { value: 'BATSMAN', label: 'Batsman' },
                { value: 'BOWLER', label: 'Bowler' },
                { value: 'WICKETKEEPER', label: 'Wicketkeeper' },
                { value: 'BATSMAN_BOWLER', label: 'Batsman + Bowler' },
                { value: 'ALL_ROUNDER', label: 'All-rounder' },
              ]}
            />
          </div>

          {/* Batting Style */}
          <div>
            <Select
              label="Batting Style *"
              required
              value={formData.battingStyle || 'RIGHT_HAND'}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, battingStyle: e.target.value as BattingStyle }))
              }
              options={[
                { value: 'RIGHT_HAND', label: 'Right Hand' },
                { value: 'LEFT_HAND', label: 'Left Hand' },
              ]}
            />
          </div>

          {/* Bowling Style (Conditional UI) */}
          <div>
            <Select
              label="Bowling Style"
              disabled={formData.primaryRole === 'BATSMAN' || formData.primaryRole === 'WICKETKEEPER'}
              value={formData.bowlingStyle || 'DOESNT_BOWL'}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, bowlingStyle: e.target.value as BowlingStyle }))
              }
              error={errors.bowlingStyle}
              helperText={
                isBowlingDisabled
                  ? 'Bowling style disabled for non-bowling roles'
                  : 'Select arm and spin/fast style'
              }
              options={[
                { value: 'RIGHT_ARM_FAST', label: 'Right-arm Fast' },
                { value: 'RIGHT_ARM_MEDIUM', label: 'Right-arm Medium' },
                { value: 'RIGHT_ARM_SPIN', label: 'Right-arm Spin' },
                { value: 'LEFT_ARM_FAST', label: 'Left-arm Fast' },
                { value: 'LEFT_ARM_MEDIUM', label: 'Left-arm Medium' },
                { value: 'LEFT_ARM_SPIN', label: 'Left-arm Spin' },
                { value: 'DOESNT_BOWL', label: "Doesn't Bowl" },
              ]}
            />
          </div>

          {/* Experience Level */}
          <div className="md:col-span-2">
            <Select
              label="Experience Level (Optional)"
              value={formData.experienceLevel || ''}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, experienceLevel: e.target.value as ExperienceLevel }))
              }
              error={errors.experienceLevel}
              options={[
                { value: '', label: 'Select Experience Level (Optional)' },
                { value: 'BEGINNER', label: 'Beginner (Gully / Club Friendly)' },
                { value: 'INTERMEDIATE', label: 'Intermediate (District / Academy Level)' },
                { value: 'ADVANCED', label: 'Advanced (State / University Level)' },
                { value: 'PROFESSIONAL', label: 'Professional (Ranji / First Class)' },
              ]}
            />
          </div>

          {/* Jersey Specification Section */}
          <div className="md:col-span-2 bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-bold text-amber-400 tracking-wider uppercase">
                Official Kit & Jersey Specifications
              </span>
              <JerseyInfoTooltip />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input
                label="Jersey Name *"
                required
                value={formData.jerseyName || ''}
                onChange={(e) => setFormData((prev) => ({ ...prev, jerseyName: e.target.value }))}
                error={errors.jerseyName}
                placeholder="Name printed on back"
              />
              <Input
                label="Jersey Number *"
                required
                value={formData.jerseyNumber || ''}
                onChange={(e) => setFormData((prev) => ({ ...prev, jerseyNumber: e.target.value }))}
                error={errors.jerseyNumber}
                placeholder="e.g. 7, 18, 99"
              />
              <div>
                <Select
                  label="Jersey Size *"
                  required
                  value={formData.jerseySize || 'M'}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, jerseySize: e.target.value }))
                  }
                  options={[
                    { value: 'S', label: 'Small (S - 38")' },
                    { value: 'M', label: 'Medium (M - 40")' },
                    { value: 'L', label: 'Large (L - 42")' },
                    { value: 'XL', label: 'X-Large (XL - 44")' },
                    { value: 'XXL', label: 'XX-Large (XXL - 46")' },
                    { value: '3XL', label: '3X-Large (3XL - 48")' },
                  ]}
                />
              </div>
            </div>
          </div>

          {/* Additional Skills / Comments */}
          <div className="md:col-span-2 flex flex-col gap-1.5">
            <label className="text-xs md:text-sm font-medium text-slate-300">
              Additional Skills / Remarks (Optional)
            </label>
            <textarea
              rows={3}
              placeholder="e.g. Can open batting, death overs specialist, athletic fielder..."
              value={formData.additionalSkills || ''}
              onChange={(e) => setFormData((prev) => ({ ...prev, additionalSkills: e.target.value }))}
              className="w-full px-4 py-3 bg-slate-900/90 border border-slate-800 rounded-xl text-slate-100 text-sm md:text-base placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 transition-all"
            />
          </div>
        </div>

        {/* Buttons */}
        <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
          <Button type="button" variant="secondary" onClick={onBack} leftIcon={<ArrowLeft className="w-5 h-5" />} className="w-full sm:w-auto">
            Back to Personal
          </Button>
          <Button type="submit" size="lg" className="w-full sm:w-auto" rightIcon={<ArrowRight className="w-5 h-5" />}>
            Review Registration
          </Button>
        </div>
      </div>
    </form>
  );
};
