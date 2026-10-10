'use client';

import React from 'react';
import { FullPlayerProfile } from '@/types';
import { formatPaiseToINR, formatDate, cricketRoleLabels } from '@/lib/utils/format';
import { Trophy, CheckCircle2, Printer, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import Link from 'next/link';

export interface PrintableReceiptProps {
  profile: FullPlayerProfile;
}

export const PrintableReceipt: React.FC<PrintableReceiptProps> = ({ profile }) => {
  const { player, registration, payment, tournament } = profile;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Top Action Bar (hidden on print) */}
      <div className="no-print flex items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg">
        <Link href="/">
          <Button variant="secondary" size="sm" leftIcon={<ArrowLeft className="w-4 h-4" />}>
            Return Home
          </Button>
        </Link>
        <Button variant="primary" size="sm" onClick={handlePrint} leftIcon={<Printer className="w-4 h-4" />}>
          Print Confirmation / Download Receipt
        </Button>
      </div>

      {/* Main Printable Receipt Card */}
      <div className="printable-receipt-card bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-10 shadow-2xl space-y-8 relative overflow-hidden">
        {/* Header */}
        <div className="border-b border-slate-800 pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shrink-0 shadow-lg">
              <Trophy className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                {tournament.name}
              </h1>
              <p className="text-xs text-emerald-400 font-semibold tracking-wider uppercase">
                Official Registration Receipt & Entry Pass
              </p>
            </div>
          </div>

          <div className="text-left sm:text-right bg-emerald-950/60 border border-emerald-500/40 rounded-xl px-4 py-2 self-start sm:self-auto">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
              Registration Number
            </span>
            <span className="text-base sm:text-lg font-mono font-extrabold text-emerald-300">
              {registration.registration_number}
            </span>
          </div>
        </div>

        {/* Registration Status Banner */}
        <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
          <div>
            <h3 className="text-sm font-bold text-emerald-300">
              Registration {registration.registration_status === 'CONFIRMED' ? 'Confirmed 🎉' : 'Waitlisted'}
            </h3>
            <p className="text-xs text-slate-300">
              Payment of {formatPaiseToINR(payment?.amount || tournament.registration_fee)} is {payment?.payment_status || 'PENDING'}.
            </p>
          </div>
        </div>

        {/* Player Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs sm:text-sm">
          {/* Player Info */}
          <div className="space-y-2 bg-slate-950/50 border border-slate-800 rounded-xl p-4">
            <h4 className="font-bold text-emerald-400 uppercase tracking-wider text-xs border-b border-slate-800 pb-2 mb-3">
              Player Details
            </h4>
            <div className="flex justify-between py-1 border-b border-slate-900">
              <span className="text-slate-400">Full Name:</span>
              <span className="font-bold text-white">{registration.registered_name_snapshot || player.full_name}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-900">
              <span className="text-slate-400">Email:</span>
              <span className="font-semibold text-slate-200">{player.email || 'N/A'}</span>
            </div>
          </div>

          {/* Cricket Info */}
          <div className="space-y-2 bg-slate-950/50 border border-slate-800 rounded-xl p-4">
            <h4 className="font-bold text-emerald-400 uppercase tracking-wider text-xs border-b border-slate-800 pb-2 mb-3">
              Cricket Profile
            </h4>
            <div className="flex justify-between py-1 border-b border-slate-900">
              <span className="text-slate-400">Playing Role:</span>
              <span className="font-bold text-emerald-300">
                {cricketRoleLabels[registration.registered_role_snapshot as keyof typeof cricketRoleLabels] || registration.registered_role_snapshot || player.cricket_role}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-900">
              <span className="text-slate-400">Batting Style:</span>
              <span className="font-semibold text-slate-200">
                {(registration.registered_batting_style_snapshot || player.batting_style || 'N/A').replace('_', ' ')}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-900">
              <span className="text-slate-400">Jersey Name / No:</span>
              <span className="font-bold text-white">
                {registration.registered_jersey_name_snapshot || player.jersey_name || 'N/A'}{' '}
                {(registration.registered_jersey_number_snapshot || player.jersey_number)
                  ? `#${registration.registered_jersey_number_snapshot || player.jersey_number}`
                  : ''}
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-400">Jersey Size:</span>
              <span className="font-bold text-amber-400">
                {registration.registered_jersey_size_snapshot || player.jersey_size || 'M'}
              </span>
            </div>
          </div>
        </div>

        {/* Payment Metadata */}
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 text-xs space-y-2">
          <h4 className="font-bold text-slate-300 uppercase tracking-wider text-xs border-b border-slate-800 pb-2 mb-2">
            Payment Audit Meta
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-slate-300">
            <div>
              <span className="text-slate-400 block text-[10px]">Payment ID</span>
              <span className="font-mono font-semibold">{payment?.id || 'N/A'}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px]">Txn Reference</span>
              <span className="font-mono font-semibold">{payment?.transaction_reference || 'N/A'}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px]">Amount Paid</span>
              <span className="font-bold text-emerald-400">
                {formatPaiseToINR(payment?.amount || tournament.registration_fee)}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px]">Date & Time</span>
              <span className="font-semibold">{formatDate(payment?.verified_at || registration.registered_at)}</span>
            </div>
          </div>
        </div>

        {/* Footer Authorization Stamp */}
        <div className="pt-6 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-4">
          <div>
            <p className="font-semibold text-slate-300">Organized by FairPlay Premier League (FPL)</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Contact: {tournament.contact_phone || '+91 86525 26186'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
