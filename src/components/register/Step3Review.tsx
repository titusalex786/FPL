'use client';

import React, { useState } from 'react';
import { Step1PersonalInput, Step2CricketInput } from '@/lib/validation/registration';
import { Button } from '@/components/ui/Button';
import { formatPaiseToINR, cricketRoleLabels } from '@/lib/utils/format';
import { CheckCircle2, Edit3, CreditCard, ShieldAlert, ArrowLeft } from 'lucide-react';

export interface Step3Props {
  personalData: Step1PersonalInput;
  cricketData: Step2CricketInput;
  registrationFeePaise: number;
  onEdit: () => void;
  onSubmitPayment: () => void;
  isLoading: boolean;
}

export const Step3Review: React.FC<Step3Props> = ({
  personalData,
  cricketData,
  registrationFeePaise,
  onEdit,
  onSubmitPayment,
  isLoading,
}) => {
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleProceed = () => {
    if (!termsAccepted) {
      setErrorMsg('You must check and agree to the tournament terms and conditions to proceed.');
      return;
    }
    setErrorMsg(null);
    onSubmitPayment();
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 md:p-8 space-y-6 shadow-xl">
        <div className="border-b border-slate-800 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg md:text-xl font-bold text-slate-100 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span>Step 3: Review Registration Details</span>
            </h2>
            <p className="text-xs md:text-sm text-slate-400 mt-1">
              Double-check all entered information before proceeding to payment.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onEdit}
            leftIcon={<Edit3 className="w-4 h-4" />}
            className="shrink-0 self-start sm:self-auto"
          >
            Edit Details
          </Button>
        </div>

        {/* Player Profile Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Personal Info Box */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-bold text-emerald-400 tracking-wider uppercase border-b border-slate-800 pb-2">
              Personal Information
            </h3>
            <div className="space-y-2 text-xs md:text-sm">
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Full Name:</span>
                <span className="font-semibold text-slate-100 text-right">{personalData.fullName}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Mobile Number:</span>
                <span className="font-semibold text-slate-100 text-right">+91 {personalData.mobile}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Email:</span>
                <span className="font-semibold text-slate-100 text-right">{personalData.email || 'N/A'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Date of Birth:</span>
                <span className="font-semibold text-slate-100 text-right">{personalData.dateOfBirth || 'N/A'}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">City:</span>
                <span className="font-semibold text-slate-100 text-right">{personalData.city || 'N/A'}</span>
              </div>
            </div>
          </div>

          {/* Cricket Info Box */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-bold text-emerald-400 tracking-wider uppercase border-b border-slate-800 pb-2">
              Cricket Information
            </h3>
            <div className="space-y-2 text-xs md:text-sm">
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Primary Role:</span>
                <span className="font-semibold text-emerald-300 text-right">
                  {cricketRoleLabels[cricketData.primaryRole as keyof typeof cricketRoleLabels] || cricketData.primaryRole}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Batting Style:</span>
                <span className="font-semibold text-slate-100 text-right">
                  {cricketData.battingStyle ? cricketData.battingStyle.replace('_', ' ') : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Bowling Style:</span>
                <span className="font-semibold text-slate-100 text-right">
                  {cricketData.bowlingStyle ? cricketData.bowlingStyle.replace(/_/g, ' ') : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Experience Level:</span>
                <span className="font-semibold text-slate-100 text-right">{cricketData.experienceLevel || 'N/A'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Jersey Name:</span>
                <span className="font-bold text-amber-300 text-right">{cricketData.jerseyName || 'N/A'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Jersey Number:</span>
                <span className="font-bold text-amber-300 font-mono text-right">#{cricketData.jerseyNumber || 'N/A'}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Jersey Size:</span>
                <span className="font-bold text-amber-400 text-right">{cricketData.jerseySize || 'M'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Fee & Payable Summary */}
        <div className="bg-gradient-to-r from-emerald-950/40 to-teal-950/40 border border-emerald-500/30 rounded-xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <span className="text-xs uppercase tracking-wider text-emerald-400 font-bold block">
              Registration Fee
            </span>
            <p className="text-xs text-slate-400 mt-0.5">
              Includes player kit ID reference & match participation eligibility.
            </p>
          </div>
          <div className="text-right">
            <span className="text-2xl md:text-3xl font-extrabold text-white">
              {formatPaiseToINR(registrationFeePaise)}
            </span>
          </div>
        </div>

        {/* Terms & Conditions Checkbox */}
        <div className="space-y-3 pt-2">
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => {
                setTermsAccepted(e.target.checked);
                if (e.target.checked) setErrorMsg(null);
              }}
              className="w-5 h-5 mt-0.5 rounded border-slate-700 bg-slate-950 text-emerald-600 focus:ring-emerald-500 focus:ring-offset-slate-900 cursor-pointer"
            />
            <span className="text-xs md:text-sm text-slate-300 leading-relaxed group-hover:text-slate-100">
              I hereby declare that all provided details are true and accurate. I agree to abide by the tournament rules, conduct code, and medical clearance policies.
            </span>
          </label>

          {errorMsg && (
            <div className="p-3 bg-rose-950/60 border border-rose-500/40 rounded-xl text-rose-300 text-xs flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Form Controls */}
        <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
          <Button type="button" variant="secondary" onClick={onEdit} leftIcon={<ArrowLeft className="w-5 h-5" />} className="w-full sm:w-auto">
            Back to Edit
          </Button>
          <Button
            type="button"
            size="lg"
            variant="primary"
            isLoading={isLoading}
            onClick={handleProceed}
            rightIcon={<CreditCard className="w-5 h-5" />}
            className="w-full sm:w-auto"
          >
            Proceed to Payment ({formatPaiseToINR(registrationFeePaise)})
          </Button>
        </div>
      </div>
    </div>
  );
};
