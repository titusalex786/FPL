'use client';

import React, { useState } from 'react';
import { Step1PersonalInput } from '@/lib/validation/registration';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { compressImageFile } from '@/lib/utils/image';
import { User, Phone, Mail, Calendar, MapPin, Upload, ArrowRight, Image as ImageIcon } from 'lucide-react';

export interface Step1Props {
  initialData: Step1PersonalInput;
  onNext: (data: Step1PersonalInput) => void;
}

export const Step1Personal: React.FC<Step1Props> = ({ initialData, onNext }) => {
  const [formData, setFormData] = useState<Step1PersonalInput>(initialData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(initialData.profilePhotoPath || null);
  const [regTarget, setRegTarget] = useState<'SELF' | 'OTHER'>('SELF');

  const handleTargetChange = (target: 'SELF' | 'OTHER') => {
    setRegTarget(target);
    if (target === 'OTHER') {
      // Clear fields for registering another player/teammate
      setFormData({
        fullName: '',
        mobile: '',
        email: '',
        dateOfBirth: '',
        city: '',
        profilePhotoPath: '',
      });
      setPreviewPhoto(null);
    } else {
      // Restore initial self profile
      setFormData(initialData);
      setPreviewPhoto(initialData.profilePhotoPath || null);
    }
  };

  const handleInputChange = (field: keyof Step1PersonalInput, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const updated = { ...prev };
        delete updated[field];
        return updated;
      });
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setErrors((prev) => ({ ...prev, profilePhotoPath: 'Please upload a JPG, PNG or WebP image' }));
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setErrors((prev) => ({ ...prev, profilePhotoPath: 'File size must be under 5 MB' }));
      return;
    }

    try {
      const compressed = await compressImageFile(file, 1000, 1000, 0.8);
      if (compressed) {
        setPreviewPhoto(compressed);
        setFormData((prev) => ({ ...prev, profilePhotoPath: compressed }));
        if (errors.profilePhotoPath) {
          setErrors((prev) => {
            const updated = { ...prev };
            delete updated.profilePhotoPath;
            return updated;
          });
        }
        return;
      }
    } catch {
      // Fallback to FileReader
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      setPreviewPhoto(result);
      setFormData((prev) => ({ ...prev, profilePhotoPath: result }));
      if (errors.profilePhotoPath) {
        setErrors((prev) => {
          const updated = { ...prev };
          delete updated.profilePhotoPath;
          return updated;
        });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!formData.fullName || formData.fullName.trim().length < 2) {
      newErrors.fullName = 'Please enter full name (at least 2 characters)';
    }

    const cleanMobile = (formData.mobile || '').replace(/\s+|-|\+91/g, '');
    if (!cleanMobile || !/^[6-9]\d{9}$/.test(cleanMobile)) {
      newErrors.mobile = 'Enter a valid 10-digit Indian mobile number (e.g. 9876543210)';
    }

    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (!formData.profilePhotoPath) {
      newErrors.profilePhotoPath = 'Please upload profile photo to proceed';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onNext({ ...formData, mobile: cleanMobile, registrationFor: regTarget });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 animate-fadeIn">
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 md:p-8 space-y-6 shadow-xl">
        <div className="border-b border-slate-800 pb-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg md:text-xl font-bold text-slate-100 flex items-center gap-2">
                <User className="w-5 h-5 text-emerald-400" />
                <span>Step 1: Personal Information</span>
              </h2>
              <p className="text-xs md:text-sm text-slate-400 mt-1">
                Enter contact and profile details for this registration.
              </p>
            </div>
          </div>

          {/* Multi-Player Registration Target Selector */}
          <div className="bg-slate-950/80 p-1.5 rounded-xl border border-slate-800 grid grid-cols-2 gap-2 text-xs font-semibold">
            <button
              type="button"
              onClick={() => handleTargetChange('SELF')}
              className={`py-2 px-3 rounded-lg transition-all ${
                regTarget === 'SELF'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              🙋‍♂️ Registering Myself
            </button>
            <button
              type="button"
              onClick={() => handleTargetChange('OTHER')}
              className={`py-2 px-3 rounded-lg transition-all ${
                regTarget === 'OTHER'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              👥 Register Teammate / Other Player
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {/* Full Name */}
          <div className="md:col-span-2">
            <Input
              label="Full Name"
              required
              placeholder="e.g. Rahul Patil"
              value={formData.fullName}
              onChange={(e) => handleInputChange('fullName', e.target.value)}
              error={errors.fullName}
            />
          </div>

          {/* Mobile Number */}
          <div>
            <Input
              label="Mobile Number (10 digits)"
              required
              type="tel"
              placeholder="e.g. 9876543210"
              value={formData.mobile}
              onChange={(e) => handleInputChange('mobile', e.target.value)}
              error={errors.mobile}
              helperText="Indian 10-digit mobile number"
            />
          </div>

          {/* Email Address */}
          <div>
            <Input
              label="Email Address (Optional)"
              type="email"
              placeholder="rahul.patil@example.com"
              value={formData.email || ''}
              onChange={(e) => handleInputChange('email', e.target.value)}
              error={errors.email}
            />
          </div>

          {/* Date of Birth */}
          <div>
            <Input
              label="Date of Birth"
              type="date"
              value={formData.dateOfBirth || ''}
              onChange={(e) => handleInputChange('dateOfBirth', e.target.value)}
              error={errors.dateOfBirth}
            />
          </div>

          {/* City */}
          <div>
            <Input
              label="City / Location"
              placeholder="e.g. Mumbai"
              value={formData.city || ''}
              onChange={(e) => handleInputChange('city', e.target.value)}
              error={errors.city}
            />
          </div>

          {/* Profile Photo Upload */}
          <div className="md:col-span-2 space-y-2">
            <label className="text-xs md:text-sm font-medium text-slate-300 block">
              Profile Photo <span className="text-rose-400">*</span>
            </label>
            <div className="flex flex-col sm:flex-row items-center gap-4 p-4 bg-slate-950/60 border border-dashed border-slate-700 rounded-xl">
              {previewPhoto ? (
                <div className="relative w-16 h-16 rounded-full overflow-hidden border-2 border-emerald-500 shrink-0">
                  <img src={previewPhoto} alt="Profile preview" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 shrink-0">
                  <ImageIcon className="w-8 h-8" />
                </div>
              )}
              <div className="flex-1 text-center sm:text-left">
                <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs sm:text-sm font-medium rounded-xl border border-slate-700 transition-colors">
                  <Upload className="w-4 h-4 text-emerald-400" />
                  <span>Choose Photo</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handlePhotoUpload}
                  />
                </label>
                <p className="text-[11px] text-slate-400 mt-1">
                  Required: JPG, PNG or WebP (Max 2 MB)
                </p>
                {errors.profilePhotoPath && (
                  <p className="text-xs text-rose-400 mt-1">{errors.profilePhotoPath}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Submit & Next Button */}
        <div className="pt-4 border-t border-slate-800 flex justify-end">
          <Button type="submit" size="lg" className="w-full sm:w-auto" rightIcon={<ArrowRight className="w-5 h-5" />}>
            Continue to Cricket Details
          </Button>
        </div>
      </div>
    </form>
  );
};
