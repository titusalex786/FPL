'use client';

import React, { useState } from 'react';
import { Input } from '@/components/ui/Input';
import { compressImageFile } from '@/lib/utils/image';
import { JerseyInfoTooltip } from '@/components/ui/JerseyInfoTooltip';
import { JERSEY_SIZE_OPTIONS } from '@/lib/utils/jersey-size';
import { Upload, Image as ImageIcon, ShieldAlert } from 'lucide-react';

export interface ParticipantFormData {
  fullName: string;
  email: string;
  mobile: string;
  cricketRole: string;
  battingStyle: string;
  bowlingStyle: string;
  jerseyName: string;
  jerseyNumber: string;
  jerseySize: string;
  photoUrl: string;
}

interface UnifiedParticipantFormProps {
  title?: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: string;
  initialData?: Partial<ParticipantFormData>;
  onChange: (data: ParticipantFormData) => void;
  currentUserEmail?: string;
  photoRequired?: boolean;
}

export const CRICKET_ROLE_OPTIONS = [
  { value: 'BATSMAN', label: 'Batsman' },
  { value: 'BOWLER', label: 'Bowler' },
  { value: 'ALL_ROUNDER', label: 'All-Rounder' },
  { value: 'BATSMAN_WICKETKEEPER', label: 'Batsman + Wicketkeeper' },
  { value: 'BOWLER_WICKETKEEPER', label: 'Bowler + Wicketkeeper' },
];

export const BATTING_STYLE_OPTIONS = [
  { value: 'RIGHT_HAND', label: 'Right Hand' },
  { value: 'LEFT_HAND', label: 'Left Hand' },
];

export const BOWLING_STYLE_OPTIONS = [
  { value: '', label: 'Select Bowling Style' },
  { value: 'DOESNT_BOWL', label: "Doesn't Bowl" },
  { value: 'RIGHT_ARM_FAST', label: 'Right Arm Fast' },
  { value: 'RIGHT_ARM_MEDIUM', label: 'Right Arm Medium' },
  { value: 'RIGHT_ARM_SPIN', label: 'Right Arm Spin' },
  { value: 'LEFT_ARM_FAST', label: 'Left Arm Fast' },
  { value: 'LEFT_ARM_MEDIUM', label: 'Left Arm Medium' },
  { value: 'LEFT_ARM_SPIN', label: 'Left Arm Spin' },
];

export { JERSEY_SIZE_OPTIONS } from '@/lib/utils/jersey-size';
import { toNumericJerseySize } from '@/lib/utils/jersey-size';

const ROLES_REQUIRING_BOWLING_STYLE = ['BOWLER', 'ALL_ROUNDER', 'BOWLER_WICKETKEEPER'];

export const UnifiedParticipantForm: React.FC<UnifiedParticipantFormProps> = ({
  title,
  subtitle,
  badge,
  badgeColor = 'text-amber-400 bg-amber-950 border-amber-500/40',
  initialData = {},
  onChange,
  currentUserEmail = '',
  photoRequired = true,
}) => {
  const [formData, setFormData] = useState<ParticipantFormData>({
    fullName: initialData.fullName || '',
    email: initialData.email || currentUserEmail || '',
    mobile: initialData.mobile || '',
    cricketRole: initialData.cricketRole || 'BATSMAN',
    battingStyle: initialData.battingStyle || 'RIGHT_HAND',
    bowlingStyle: initialData.bowlingStyle || '',
    jerseyName: initialData.jerseyName || initialData.fullName || '',
    jerseyNumber: initialData.jerseyNumber || '',
    jerseySize: initialData.jerseySize ? toNumericJerseySize(initialData.jerseySize) : '40',
    photoUrl: initialData.photoUrl || '',
  });

  const [uploadError, setUploadError] = useState<string | null>(null);
  const requiresBowlingStyle = ROLES_REQUIRING_BOWLING_STYLE.includes(formData.cricketRole);

  const updateField = (field: keyof ParticipantFormData, value: string) => {
    const updated = { ...formData, [field]: value };
    if (field === 'cricketRole') {
      if (ROLES_REQUIRING_BOWLING_STYLE.includes(value)) {
        if (!updated.bowlingStyle || updated.bowlingStyle === 'DOESNT_BOWL') {
          updated.bowlingStyle = '';
        }
      } else {
        updated.bowlingStyle = 'DOESNT_BOWL';
      }
    }
    // Auto-sync jersey name if not custom edited
    if (field === 'fullName' && (!formData.jerseyName || formData.jerseyName === formData.fullName)) {
      updated.jerseyName = value;
    }
    setFormData(updated);
    onChange(updated);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setUploadError('Profile photo must be JPG, PNG or WebP');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Profile photo must be under 5 MB');
      return;
    }

    try {
      const compressed = await compressImageFile(file);
      if (compressed) {
        setUploadError(null);
        updateField('photoUrl', compressed);
        return;
      }
    } catch {
      // Fallback
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setUploadError(null);
      updateField('photoUrl', reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-4">
      {(title || badge) && (
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          {title && <span className="text-xs font-extrabold text-slate-200 uppercase tracking-wider">{title}</span>}
          {badge && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badgeColor}`}>
              {badge}
            </span>
          )}
        </div>
      )}

      {subtitle && <p className="text-[11px] text-slate-400 -mt-1">{subtitle}</p>}

      {/* PHOTO UPLOAD */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-slate-300 block">
          Participant Photo {photoRequired ? '*' : '(Optional)'}
        </label>
        <div className="flex items-center gap-4 p-3 bg-slate-950/60 border border-dashed border-slate-700 rounded-xl">
          {formData.photoUrl ? (
            <img
              src={formData.photoUrl}
              alt="Participant Photo"
              className="w-16 h-16 rounded-full object-cover border-2 border-emerald-500 shrink-0"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 shrink-0">
              <ImageIcon className="w-7 h-7" />
            </div>
          )}
          <div className="flex-1">
            <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition-colors">
              <Upload className="w-4 h-4 text-emerald-400" />
              <span>{formData.photoUrl ? 'Change Photo' : 'Upload Photo'}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handlePhotoUpload}
              />
            </label>
            <p className="text-[10px] text-slate-400 mt-1">JPG, PNG or WebP (Max 5 MB)</p>
          </div>
        </div>
        {uploadError && (
          <p className="text-[11px] text-rose-400 flex items-center gap-1 mt-1">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>{uploadError}</span>
          </p>
        )}
      </div>

      {/* PERSONAL INPUTS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          label="Full Name *"
          required
          value={formData.fullName}
          onChange={(e) => updateField('fullName', e.target.value)}
          placeholder="e.g. Rahul Sharma"
        />
        <Input
          label="Mobile Number *"
          type="tel"
          required
          value={formData.mobile}
          onChange={(e) => updateField('mobile', e.target.value)}
          placeholder="10 digit mobile"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-1 gap-3">
        <div>
          <Input
            label="Contact Email"
            type="email"
            value={formData.email}
            onChange={(e) => updateField('email', e.target.value)}
            placeholder="contact@example.com"
          />
          {currentUserEmail && (
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              Logged in as: <code className="text-emerald-400 font-mono">{currentUserEmail}</code> (Contact email is reusable for multiple participants)
            </span>
          )}
        </div>
      </div>

      {/* CRICKET DETAILS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
        <div>
          <label className="text-[11px] font-medium text-slate-300 block mb-1">Cricket Role *</label>
          <select
            value={formData.cricketRole}
            onChange={(e) => updateField('cricketRole', e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            {CRICKET_ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[11px] font-medium text-slate-300 block mb-1">Batting Style *</label>
          <select
            value={formData.battingStyle}
            onChange={(e) => updateField('battingStyle', e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            {BATTING_STYLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[11px] font-medium text-slate-300 block mb-1">
            Bowling Style{requiresBowlingStyle ? ' *' : ''}
          </label>
          <select
            required={requiresBowlingStyle}
            value={formData.bowlingStyle}
            onChange={(e) => updateField('bowlingStyle', e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            {BOWLING_STYLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* JERSEY DETAILS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
        <Input
          label="Jersey Name *"
          required
          value={formData.jerseyName}
          onChange={(e) => updateField('jerseyName', e.target.value)}
          placeholder="Name on jersey"
        />
        <Input
          label="Jersey Number *"
          required
          value={formData.jerseyNumber}
          onChange={(e) => updateField('jerseyNumber', e.target.value)}
          placeholder="e.g. 7 or 18"
        />
        <div>
          <div className="flex items-center gap-1 mb-1">
            <label className="text-[11px] font-medium text-slate-300 block">Jersey Size *</label>
            <JerseyInfoTooltip />
          </div>
          <select
            value={formData.jerseySize}
            onChange={(e) => updateField('jerseySize', e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            {JERSEY_SIZE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};
