'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useMyRegistrations, MyRegistrationData } from './MyRegistrationContext';
import { computeDerivedRegistrationStatus } from '@/lib/utils/derived-status';
import { formatPaiseToINR, formatDate, cricketRoleLabels } from '@/lib/utils/format';
import { UPIPaymentChoice } from '@/components/ui/UPIPaymentChoice';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import {
  Trophy,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  Upload,
  Check,
  ShieldAlert,
  Image as ImageIcon,
  ExternalLink,
  ChevronRight,
  Edit3,
  Calendar,
} from 'lucide-react';

export const MyRegistrationSection: React.FC = () => {
  const { registrations, loading, refresh } = useMyRegistrations();
  const [selectedRegId, setSelectedRegId] = useState<string | null>(null);

  // Screenshot upload state for in-card payment upload
  const [screenshotFileBase64, setScreenshotFileBase64] = useState<string>('');
  const [transactionRef, setTransactionRef] = useState<string>('');
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<boolean>(false);

  // Correction Edit & Resubmit Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [editName, setEditName] = useState<string>('');
  const [editJerseyName, setEditJerseyName] = useState<string>('');
  const [editJerseyNumber, setEditJerseyNumber] = useState<string>('');
  const [editJerseySize, setEditJerseySize] = useState<string>('M');
  const [editRole, setEditRole] = useState<string>('BATSMAN');
  const [editBattingStyle, setEditBattingStyle] = useState<string>('RIGHT_HAND');
  const [editBowlingStyle, setEditBowlingStyle] = useState<string>('DOESNT_BOWL');
  const [editProfileImage, setEditProfileImage] = useState<string>('');
  const [editScreenshotBase64, setEditScreenshotBase64] = useState<string>('');
  const [editTxnRef, setEditTxnRef] = useState<string>('');
  const [resubmitSubmitting, setResubmitSubmitting] = useState<boolean>(false);
  const [resubmitError, setResubmitError] = useState<string | null>(null);
  const [resubmitSuccess, setResubmitSuccess] = useState<string | null>(null);

  if (loading || registrations.length === 0) {
    return null;
  }

  const activeRegistration: MyRegistrationData =
    registrations.find((r) => r.id === selectedRegId) || registrations[0];

  const derivedStatus = computeDerivedRegistrationStatus(
    activeRegistration,
    activeRegistration.payment,
    activeRegistration.tournament
  );

  const isCorrectionMode = derivedStatus.key === 'CORRECTION_REQUIRED';
  const isConfirmed = derivedStatus.key === 'CONFIRMED';
  const isPaymentPending = derivedStatus.key === 'PAYMENT_PENDING';
  const isRejected = derivedStatus.key === 'REJECTED';
  const isWaitlisted = derivedStatus.key === 'WAITLISTED';

  const paymentRecord = activeRegistration.payment;
  const tournamentRecord = activeRegistration.tournament;
  const isPaymentPaid = paymentRecord?.payment_status === 'SUCCESSFUL';
  const hasScreenshot = Boolean(
    paymentRecord?.screenshot_object_path || paymentRecord?.payment_screenshot_url
  );

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new window.Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            const maxDim = 1200;
            if (width > maxDim || height > maxDim) {
              if (width > height) {
                height = Math.round((height * maxDim) / width);
                width = maxDim;
              } else {
                width = Math.round((width * maxDim) / height);
                height = maxDim;
              }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, 0, 0, width, height);
              resolve(canvas.toDataURL('image/jpeg', 0.85));
            } else {
              resolve(event.target?.result as string);
            }
          } catch {
            resolve(event.target?.result as string);
          }
        };
        img.onerror = () => resolve(event.target?.result as string);
        img.src = event.target?.result as string;
      };
      reader.onerror = () => {
        const fallbackReader = new FileReader();
        fallbackReader.onloadend = () => resolve(fallbackReader.result as string);
        fallbackReader.readAsDataURL(file);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleScreenshotFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setUploadError('Please select a valid JPG, PNG, or WebP screenshot');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File size exceeds 10 MB. Please select a smaller screenshot image.');
      return;
    }

    try {
      const compressed = await compressImage(file);
      setScreenshotFileBase64(compressed);
      setUploadError(null);
    } catch {
      setUploadError('Failed to process screenshot file');
    }
  };

  const handleSubmitScreenshot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!screenshotFileBase64) {
      setUploadError('Please select a payment screenshot before submitting.');
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      const res = await fetch(`/api/registrations/${activeRegistration.id}/screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screenshotUrl: screenshotFileBase64,
          transactionReference: transactionRef,
          paymentDate: new Date().toISOString(),
        }),
      });

      const result = await res.json();

      if (!res.ok || result.error) {
        setUploadError(result.error || 'Failed to submit payment screenshot');
        setUploading(false);
        return;
      }

      setUploadSuccess(true);
      setUploading(false);
      setScreenshotFileBase64('');
      setTransactionRef('');

      // Refresh data so My Registration instantly reflects Screenshot Submitted / Payment Verification Pending
      await refresh();
      setTimeout(() => {
        setUploadSuccess(false);
      }, 4000);
    } catch {
      setUploadError('Network error uploading screenshot');
      setUploading(false);
    }
  };

  const ROLE_OPTIONS = [
    { value: 'BATSMAN', label: 'Batsman' },
    { value: 'BOWLER', label: 'Bowler' },
    { value: 'ALL_ROUNDER', label: 'All-Rounder' },
    { value: 'BATSMAN_WICKETKEEPER', label: 'Batsman + Wicketkeeper' },
    { value: 'BOWLER_WICKETKEEPER', label: 'Bowler + Wicketkeeper' },
  ];

  const BATTING_OPTIONS = [
    { value: 'RIGHT_HAND', label: 'Right-hand' },
    { value: 'LEFT_HAND', label: 'Left-hand' },
  ];

  const BOWLING_OPTIONS = [
    { value: 'DOESNT_BOWL', label: "Doesn't Bowl" },
    { value: 'RIGHT_ARM_FAST', label: 'Right-arm Fast' },
    { value: 'RIGHT_ARM_MEDIUM', label: 'Right-arm Medium' },
    { value: 'RIGHT_ARM_SPIN', label: 'Right-arm Spin' },
    { value: 'LEFT_ARM_FAST', label: 'Left-arm Fast' },
    { value: 'LEFT_ARM_MEDIUM', label: 'Left-arm Medium' },
    { value: 'LEFT_ARM_SPIN', label: 'Left-arm Spin' },
  ];

  const JERSEY_SIZE_OPTIONS = [
    { value: 'S', label: 'Small (S - 38")' },
    { value: 'M', label: 'Medium (M - 40")' },
    { value: 'L', label: 'Large (L - 42")' },
    { value: 'XL', label: 'X-Large (XL - 44")' },
    { value: 'XXL', label: 'XX-Large (XXL - 46")' },
    { value: '3XL', label: '3X-Large (3XL - 48")' },
  ];

  const correctionHistory = activeRegistration.correction_history || [];
  const activeCorrection =
    [...correctionHistory].reverse().find((h: any) => !h.resolved_at) ||
    correctionHistory[correctionHistory.length - 1];
  const adminRemark =
    activeCorrection?.remark ||
    activeCorrection?.original_remark ||
    activeRegistration.admin_remarks ||
    'Please review your registration details or payment screenshot.';
  const correctionDate =
    activeCorrection?.requested_date ||
    activeCorrection?.requested_at ||
    activeRegistration.correction_requested_at ||
    activeRegistration.registered_at;
  const requestedFields: string[] = activeCorrection?.requested_fields || [];

  const isFieldRequested = (fieldKeyword: string) => {
    if (!requestedFields || requestedFields.length === 0) return false;
    return requestedFields.some((f: string) =>
      f.toLowerCase().includes(fieldKeyword.toLowerCase())
    );
  };

  const openEditModal = () => {
    setEditName(activeRegistration.registered_name_snapshot || '');
    setEditJerseyName(activeRegistration.registered_jersey_name_snapshot || '');
    setEditJerseyNumber(activeRegistration.registered_jersey_number_snapshot || '');
    setEditJerseySize(activeRegistration.registered_jersey_size_snapshot || 'M');
    setEditRole(activeRegistration.registered_role_snapshot || 'BATSMAN');
    setEditBattingStyle(activeRegistration.registered_batting_style_snapshot || 'RIGHT_HAND');
    setEditBowlingStyle(activeRegistration.registered_bowling_style_snapshot || 'DOESNT_BOWL');
    setEditProfileImage(activeRegistration.registered_image_snapshot || '');
    setEditScreenshotBase64('');
    setEditTxnRef(activeRegistration.payment?.transaction_reference || '');
    setResubmitError(null);
    setResubmitSuccess(null);
    setIsEditModalOpen(true);
  };

  const handleProfilePhotoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setResubmitError('Please select a valid JPG, PNG, or WebP photo');
      return;
    }
    try {
      const compressed = await compressImage(file);
      setEditProfileImage(compressed);
      setResubmitError(null);
    } catch {
      setResubmitError('Failed to process profile photo');
    }
  };

  const handleReplacementScreenshotFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setResubmitError('Please select a valid JPG, PNG, or WebP payment screenshot');
      return;
    }
    try {
      const compressed = await compressImage(file);
      setEditScreenshotBase64(compressed);
      setResubmitError(null);
    } catch {
      setResubmitError('Failed to process payment screenshot');
    }
  };

  const handleResubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    setResubmitSubmitting(true);
    setResubmitError(null);
    setResubmitSuccess(null);

    const payload: Record<string, any> = {
      name: editName,
      jersey_name: editJerseyName,
      jersey_number: editJerseyNumber,
      jersey_size: editJerseySize,
      cricket_role: editRole,
      batting_style: editBattingStyle,
      bowling_style: editBowlingStyle,
    };

    if (editProfileImage) {
      payload.profile_image = editProfileImage;
    }

    if (editScreenshotBase64) {
      payload.screenshotBase64 = editScreenshotBase64;
    }

    if (editTxnRef) {
      payload.transaction_reference = editTxnRef;
    }

    try {
      const res = await fetch(`/api/registrations/${activeRegistration.id}/correction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await res.json();
      if (!res.ok || result.error) {
        setResubmitError(result.error || 'Failed to submit correction');
        setResubmitSubmitting(false);
        return;
      }

      setResubmitSuccess('Registration updated and resubmitted successfully! Your registration is now under Payment Verification.');
      setResubmitSubmitting(false);

      await refresh();
      setTimeout(() => {
        setIsEditModalOpen(false);
        setResubmitSuccess(null);
      }, 1500);
    } catch {
      setResubmitError('Network error resubmitting registration');
      setResubmitSubmitting(false);
    }
  };

  const amountPaise = paymentRecord?.amount || tournamentRecord?.registration_fee || 0;
  const feeDisplay = formatPaiseToINR(amountPaise);

  const showPaymentScreenshotCorrection =
    isFieldRequested('payment') ||
    isFieldRequested('screenshot') ||
    isFieldRequested('receipt') ||
    isFieldRequested('utr') ||
    Boolean(activeRegistration.payment?.verification_note);

  return (
    <section id="my-registration" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 scroll-mt-24">
      <div className="bg-gradient-to-b from-slate-900 to-slate-950 border-2 border-emerald-500/40 rounded-3xl p-6 sm:p-10 shadow-2xl space-y-8 relative overflow-hidden">
        {/* Glow ambient background effect */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 blur-[100px] pointer-events-none rounded-full" />

        {/* Header Ribbon */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-6 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-950 border border-emerald-500/40 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-2">
              <Trophy className="w-3.5 h-3.5" />
              <span>Official Tournament Entry</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              MY REGISTRATION
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
              Your registered tournament pass and verified snapshot details.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* If user has multiple registrations, provide tournament switcher */}
            {registrations.length > 1 && (
              <select
                aria-label="Select registered tournament"
                value={activeRegistration.id}
                onChange={(e) => setSelectedRegId(e.target.value)}
                className="bg-slate-950 border border-slate-700 text-white text-xs font-semibold rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500"
              >
                {registrations.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.tournament?.name || 'Tournament'} ({r.registration_number})
                  </option>
                ))}
              </select>
            )}

            <Link href={`/registration/${activeRegistration.id}`}>
              <Button size="sm" variant="outline" rightIcon={<ExternalLink className="w-3.5 h-3.5" />}>
                View Full Pass
              </Button>
            </Link>
          </div>
        </div>

        {/* TOURNAMENT HEADER STRIP */}
        <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shrink-0 shadow-lg">
              <Trophy className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg sm:text-xl font-extrabold text-white">
                {tournamentRecord?.name || 'FairPlay Premier League'}
              </h3>
              <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                <span>Date: <strong className="text-slate-200">{tournamentRecord?.tournament_date ? formatDate(tournamentRecord.tournament_date) : 'Upcoming'}</strong></span>
                <span>•</span>
                <span>Type: <strong className="text-emerald-400">{activeRegistration.registration_type || 'PLAYER'}</strong></span>
              </div>
            </div>
          </div>

          <div className="bg-emerald-950/80 border border-emerald-500/40 rounded-xl px-4 py-2 self-start sm:self-auto text-left sm:text-right">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
              Registration No
            </span>
            <span className="text-base sm:text-lg font-mono font-black text-emerald-300">
              {activeRegistration.registration_number}
            </span>
          </div>
        </div>

        {/* CANONICAL REGISTRATION STATUS HERO BANNER */}
        <div
          className={`rounded-2xl p-5 border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10 ${derivedStatus.colorClasses.bg} ${derivedStatus.colorClasses.border}`}
        >
          <div className="flex items-start gap-3.5">
            {isConfirmed && <CheckCircle2 className="w-7 h-7 text-emerald-400 shrink-0 mt-0.5" />}
            {isCorrectionMode && <AlertCircle className="w-7 h-7 text-amber-400 shrink-0 mt-0.5" />}
            {isPaymentPending && <Clock className="w-7 h-7 text-yellow-400 shrink-0 mt-0.5" />}
            {isRejected && <XCircle className="w-7 h-7 text-rose-400 shrink-0 mt-0.5" />}
            {isWaitlisted && <Clock className="w-7 h-7 text-slate-400 shrink-0 mt-0.5" />}

            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-base sm:text-lg font-black text-white">
                  {derivedStatus.fullLabel}
                </h4>
              </div>
              <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl leading-relaxed">
                {derivedStatus.description}
              </p>
            </div>
          </div>

          <div className="shrink-0 self-start sm:self-auto">
            <span
              className={`text-xs px-3.5 py-1.5 rounded-full font-black uppercase tracking-wider border ${derivedStatus.colorClasses.badgeBg} ${derivedStatus.colorClasses.badgeText} ${derivedStatus.colorClasses.badgeBorder}`}
            >
              {derivedStatus.label}
            </span>
          </div>
        </div>

        {/* CORRECTION REQUIRED DEDICATED PANEL */}
        {isCorrectionMode && (
          <div className="bg-amber-950/30 border-2 border-amber-500/50 rounded-3xl p-6 sm:p-8 shadow-xl space-y-5 relative z-10 animate-fadeIn">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-amber-500/30 pb-4">
              <div className="flex items-center gap-2.5">
                <AlertCircle className="w-6 h-6 text-amber-400 shrink-0" />
                <div>
                  <span className="text-[10px] font-extrabold text-amber-400 uppercase tracking-wider block">
                    ACTION REQUIRED
                  </span>
                  <h3 className="text-lg sm:text-xl font-black text-amber-300">
                    CORRECTION REQUIRED
                  </h3>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {correctionDate && (
                  <span className="px-3 py-1 bg-amber-950/80 border border-amber-500/40 rounded-xl text-amber-300 font-semibold flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Requested: {formatDate(correctionDate)}</span>
                  </span>
                )}
                <span className="px-3 py-1 bg-slate-900 border border-slate-700 rounded-xl text-slate-300 font-mono font-bold">
                  {activeRegistration.registration_number}
                </span>
              </div>
            </div>

            <div className="bg-slate-950/90 p-4 sm:p-5 rounded-2xl border border-amber-500/40 text-xs sm:text-sm text-amber-200 space-y-1.5 shadow-inner">
              <span className="font-extrabold text-amber-400 uppercase tracking-wider text-[11px] block">
                ADMIN REMARK:
              </span>
              <p className="whitespace-pre-wrap font-medium leading-relaxed">
                {adminRemark}
              </p>
            </div>

            {requestedFields.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-xs text-slate-400 font-semibold block">
                  Requested Correction Fields:
                </span>
                <div className="flex flex-wrap gap-2">
                  {requestedFields.map((f: string) => (
                    <span
                      key={f}
                      className="px-3 py-1 bg-amber-950/90 border border-amber-500/60 rounded-xl text-amber-300 font-bold text-xs"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-amber-500/20">
              <p className="text-xs text-slate-300">
                Please edit the requested details. Your existing registration snapshot will be updated and resubmitted for admin review.
              </p>
              <Button
                id="btn-update-resubmit"
                variant="primary"
                size="md"
                onClick={openEditModal}
                className="bg-amber-500 hover:bg-amber-400 text-black font-black whitespace-nowrap shadow-lg shadow-amber-500/20"
                leftIcon={<Edit3 className="w-4 h-4 text-black" />}
              >
                Update & Resubmit
              </Button>
            </div>
          </div>
        )}

        {/* ADMIN REMARKS (WHEN PRESENT IN NON-CORRECTION STATES) */}
        {!isCorrectionMode && activeRegistration.admin_remarks && (
          <div className="p-4 bg-slate-900 border border-slate-700 rounded-2xl text-xs space-y-1 relative z-10">
            <span className="font-bold text-slate-400 uppercase tracking-wider text-[10px] block">
              Admin Remark
            </span>
            <p className="text-slate-200">{activeRegistration.admin_remarks}</p>
          </div>
        )}

        {/* DETAILS GRID: PLAYER DETAILS + JERSEY + PAYMENT */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 relative z-10">
          {/* 1. PLAYER DETAILS CARD */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
            <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
              {activeRegistration.registered_image_snapshot ? (
                <img
                  src={activeRegistration.registered_image_snapshot}
                  alt={activeRegistration.registered_name_snapshot}
                  className="w-12 h-12 rounded-full object-cover border-2 border-emerald-500 shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 shrink-0 font-bold">
                  🏏
                </div>
              )}
              <div className="min-w-0">
                <span className="text-[10px] text-emerald-400 uppercase font-black tracking-wider block">
                  PLAYER DETAILS
                </span>
                <h4 className="text-base font-extrabold text-white truncate">
                  {activeRegistration.registered_name_snapshot}
                </h4>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Full Name:</span>
                <span className="font-bold text-white text-right">
                  {activeRegistration.registered_name_snapshot}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Email:</span>
                <span className="font-medium text-slate-300 text-right truncate max-w-[160px]">
                  {activeRegistration.player?.email || 'N/A'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Cricket Role:</span>
                <span className="font-extrabold text-emerald-400 text-right">
                  {(cricketRoleLabels as Record<string, string>)[activeRegistration.registered_role_snapshot] ||
                    activeRegistration.registered_role_snapshot}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Batting Style:</span>
                <span className="font-semibold text-slate-200 text-right">
                  {activeRegistration.registered_batting_style_snapshot
                    ? activeRegistration.registered_batting_style_snapshot.replace('_', ' ')
                    : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Bowling Style:</span>
                <span className="font-semibold text-slate-200 text-right">
                  {activeRegistration.registered_bowling_style_snapshot || 'N/A'}
                </span>
              </div>
            </div>
          </div>

          {/* 2. JERSEY ATTRIBUTES CARD */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
            <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-amber-400 uppercase font-black tracking-wider block">
                  JERSEY
                </span>
                <h4 className="text-base font-extrabold text-white">Kit Specifications</h4>
              </div>
              <div className="w-9 h-9 rounded-xl bg-amber-950 border border-amber-500/30 flex items-center justify-center text-amber-300 font-bold text-xs">
                👕
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 flex justify-between items-center">
                <span className="text-slate-400">Jersey Name:</span>
                <span className="font-black text-white text-sm">
                  {activeRegistration.registered_jersey_name_snapshot || 'N/A'}
                </span>
              </div>
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 flex justify-between items-center">
                <span className="text-slate-400">Jersey Number:</span>
                <span className="font-black text-amber-400 font-mono text-base">
                  {activeRegistration.registered_jersey_number_snapshot
                    ? `#${activeRegistration.registered_jersey_number_snapshot}`
                    : 'N/A'}
                </span>
              </div>
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 flex justify-between items-center">
                <span className="text-slate-400">Jersey Size:</span>
                <span className="font-black text-emerald-400 text-sm">
                  {activeRegistration.registered_jersey_size_snapshot || 'M'}
                </span>
              </div>
            </div>
          </div>

          {/* 3. PAYMENT DETAILS CARD */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
            <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-emerald-400 uppercase font-black tracking-wider block">
                  PAYMENT
                </span>
                <h4 className="text-base font-extrabold text-white">Payment Status & Verification</h4>
              </div>
              <div className="w-9 h-9 rounded-xl bg-emerald-950 border border-emerald-500/30 flex items-center justify-center text-emerald-300 font-bold text-xs">
                💳
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Amount:</span>
                <span className="font-black text-emerald-400 text-sm">{feeDisplay}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Method:</span>
                <span className="font-semibold text-slate-200">
                  {paymentRecord?.payment_method || 'UPI_QR'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">UPI Ref / UTR:</span>
                <span className="font-mono text-slate-200 truncate max-w-[150px]">
                  {paymentRecord?.transaction_reference || 'N/A'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Payment Date:</span>
                <span className="font-medium text-slate-300">
                  {paymentRecord?.created_at ? formatDate(paymentRecord.created_at) : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between py-1 items-center">
                <span className="text-slate-400">Payment Status:</span>
                <span
                  className={`px-2.5 py-0.5 rounded-full font-bold uppercase text-[10px] border ${
                    isPaymentPaid
                      ? 'bg-emerald-950 text-emerald-400 border-emerald-500/40'
                      : hasScreenshot
                      ? 'bg-yellow-950 text-yellow-400 border-yellow-500/40'
                      : 'bg-rose-950 text-rose-300 border-rose-500/40'
                  }`}
                >
                  {isPaymentPaid
                    ? 'Paid (Verified)'
                    : hasScreenshot
                    ? 'Screenshot Submitted'
                    : 'Payment Required'}
                </span>
              </div>

              {/* Payment Screenshot Preview if available */}
              {paymentRecord?.payment_screenshot_url && (
                <div className="pt-2 border-t border-slate-800">
                  <span className="text-[10px] text-slate-400 block mb-1.5 font-bold">
                    Uploaded Payment Receipt:
                  </span>
                  <div className="relative w-full h-24 rounded-xl overflow-hidden border border-slate-800 bg-slate-900 group">
                    <img
                      src={paymentRecord.payment_screenshot_url}
                      alt="Payment Receipt Screenshot"
                      className="w-full h-full object-contain"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* PAYMENT REQUIRED STATE & QR DISPLAY (When Payment is required and screenshot is missing) */}
        {!isPaymentPaid && !hasScreenshot && !isCorrectionMode && (
          <div className="bg-slate-900 border-2 border-amber-500/40 rounded-3xl p-6 sm:p-8 space-y-6 relative z-10 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div>
                <span className="px-3 py-1 bg-amber-950 border border-amber-500/40 text-amber-300 text-xs font-bold rounded-full uppercase inline-block mb-1">
                  Payment Required
                </span>
                <h3 className="text-xl font-extrabold text-white">
                  Payment Required: {feeDisplay}
                </h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  Scan the QR code to complete payment and upload your screenshot below for organiser verification.
                </p>
              </div>
            </div>

            {/* Tournament UPI QR Code & Instructions */}
            <div className="max-w-md mx-auto">
              <UPIPaymentChoice
                upiId={tournamentRecord?.upi_id}
                payeeName={tournamentRecord?.name || 'FairPlay Premier League'}
                amountPaise={amountPaise}
                referenceNote={`Reg ${activeRegistration.registration_number}`}
                qrUrlFallback={tournamentRecord?.payment_qr_url}
              />
            </div>

            {/* SCREENSHOT REQUIRED UPLOAD FORM */}
            <div className="pt-4 border-t border-slate-800 space-y-4">
              <div className="space-y-1">
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider block">
                  Payment Screenshot Required
                </span>
                <h4 className="font-bold text-white text-base">
                  Upload Payment Receipt Screenshot
                </h4>
                <p className="text-xs text-slate-400">
                  Attach your payment screenshot from Google Pay, PhonePe, Paytm or BHIM UPI.
                </p>
              </div>

              {uploadError && (
                <div className="p-3 bg-rose-950/80 border border-rose-500/50 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}

              {uploadSuccess && (
                <div className="p-4 bg-emerald-950/90 border border-emerald-500/50 rounded-2xl text-emerald-300 text-xs sm:text-sm flex items-start gap-3 shadow-xl">
                  <Check className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-white block">Screenshot Submitted! ✔️</span>
                    <p>Your payment verification is now PENDING organiser review.</p>
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmitScreenshot} className="space-y-4">
                <div className="flex flex-col sm:flex-row items-center gap-4 p-4 bg-slate-950/90 border border-dashed border-slate-700 rounded-2xl">
                  {screenshotFileBase64 ? (
                    <div className="relative w-20 h-20 rounded-xl overflow-hidden border-2 border-emerald-500 shrink-0 bg-slate-900">
                      <img
                        src={screenshotFileBase64}
                        alt="Selected receipt preview"
                        className="w-full h-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="w-20 h-20 rounded-xl bg-slate-900 border border-slate-800 flex flex-col items-center justify-center text-slate-500 text-[10px] shrink-0">
                      <ImageIcon className="w-6 h-6 text-slate-400 mb-1" />
                      <span>Attach image</span>
                    </div>
                  )}

                  <div className="flex-1 text-center sm:text-left space-y-1">
                    <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-colors shadow-lg">
                      <Upload className="w-4 h-4" />
                      <span>{screenshotFileBase64 ? 'Change Receipt Photo' : 'Select Payment Screenshot'}</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={handleScreenshotFileChange}
                      />
                    </label>
                    <p className="text-[11px] text-slate-400">
                      Max file size: 10 MB (JPG, PNG, WebP)
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Transaction Reference / UPI UTR ID (Optional)"
                    value={transactionRef}
                    onChange={(e) => setTransactionRef(e.target.value)}
                    placeholder="e.g. 425612345678"
                    helperText="12-digit UPI UTR reference number from payment receipt"
                  />
                  <Input
                    label="Payment Date Validation"
                    type="text"
                    disabled
                    value={`Today (${new Date().toISOString().slice(0, 10)})`}
                    helperText="Automated date validation timestamp"
                  />
                </div>

                <div className="pt-2 flex justify-end">
                  <Button
                    type="submit"
                    size="lg"
                    isLoading={uploading}
                    disabled={!screenshotFileBase64 || uploadSuccess}
                    leftIcon={<CheckCircle2 className="w-5 h-5 text-emerald-300" />}
                    className="w-full sm:w-auto"
                  >
                    Submit Screenshot for Verification
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* SCREENSHOT REQUIRED STATE (when payment made or exists, but screenshot is missing) */}
        {!isPaymentPaid && !hasScreenshot && isCorrectionMode && (
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-between text-xs">
            <span className="text-amber-300 font-semibold">
              Payment Screenshot Required for Verification
            </span>
            <Button size="sm" variant="outline" onClick={openEditModal}>
              Update & Resubmit
            </Button>
          </div>
        )}

        {/* CORRECTION EDIT & RESUBMIT MODAL */}
        <Modal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          title="Update & Resubmit Registration"
          maxWidth="xl"
        >
          <div className="space-y-6">
            {/* Header info */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                    Tournament Pass
                  </span>
                  <span className="text-sm font-extrabold text-white">
                    {tournamentRecord?.name || 'Tournament'}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                    Registration No
                  </span>
                  <span className="text-xs font-mono font-bold text-emerald-400">
                    {activeRegistration.registration_number}
                  </span>
                </div>
              </div>

              <div className="bg-amber-950/40 border border-amber-500/40 rounded-xl p-3 text-xs text-amber-200 space-y-1">
                <span className="font-bold text-amber-400 uppercase tracking-wider text-[10px] block">
                  Admin Remark:
                </span>
                <p className="whitespace-pre-wrap">{adminRemark}</p>
                {correctionDate && (
                  <span className="text-[10px] text-amber-300/70 block mt-1">
                    Requested on: {formatDate(correctionDate)}
                  </span>
                )}
              </div>
            </div>

            {resubmitError && (
              <div className="p-3 bg-rose-950/80 border border-rose-500/50 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{resubmitError}</span>
              </div>
            )}

            {resubmitSuccess && (
              <div className="p-4 bg-emerald-950/90 border border-emerald-500/50 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
                <Check className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>{resubmitSuccess}</span>
              </div>
            )}

            <form onSubmit={handleResubmitCorrection} className="space-y-5">
              <div className="space-y-4">
                {/* 1. Player Name */}
                <div
                  className={`p-3 rounded-2xl transition-all ${
                    isFieldRequested('name')
                      ? 'bg-amber-950/20 border-2 border-amber-500/60'
                      : 'bg-transparent border border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-300">
                      Player Name <span className="text-rose-400">*</span>
                    </label>
                    {isFieldRequested('name') && (
                      <span className="text-[10px] px-2 py-0.5 bg-amber-500 text-black font-extrabold rounded-full">
                        ⚠️ Correction Requested
                      </span>
                    )}
                  </div>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Full Player Name"
                    required
                  />
                </div>

                {/* 2. Jersey Attributes Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Jersey Name */}
                  <div
                    className={`p-3 rounded-2xl transition-all ${
                      isFieldRequested('jersey name')
                        ? 'bg-amber-950/20 border-2 border-amber-500/60'
                        : 'bg-transparent border border-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-bold text-slate-300">
                        Jersey Name <span className="text-rose-400">*</span>
                      </label>
                      {isFieldRequested('jersey name') && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-amber-500 text-black font-extrabold rounded-full">
                          ⚠️ Required
                        </span>
                      )}
                    </div>
                    <Input
                      value={editJerseyName}
                      onChange={(e) => setEditJerseyName(e.target.value)}
                      placeholder="Name on Jersey"
                      required
                    />
                  </div>

                  {/* Jersey Number */}
                  <div
                    className={`p-3 rounded-2xl transition-all ${
                      isFieldRequested('jersey number')
                        ? 'bg-amber-950/20 border-2 border-amber-500/60'
                        : 'bg-transparent border border-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-bold text-slate-300">
                        Jersey No. <span className="text-rose-400">*</span>
                      </label>
                      {isFieldRequested('jersey number') && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-amber-500 text-black font-extrabold rounded-full">
                          ⚠️ Required
                        </span>
                      )}
                    </div>
                    <Input
                      value={editJerseyNumber}
                      onChange={(e) => setEditJerseyNumber(e.target.value)}
                      placeholder="e.g. 7"
                      required
                    />
                  </div>

                  {/* Jersey Size */}
                  <div
                    className={`p-3 rounded-2xl transition-all ${
                      isFieldRequested('jersey size')
                        ? 'bg-amber-950/20 border-2 border-amber-500/60'
                        : 'bg-transparent border border-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-bold text-slate-300">
                        Jersey Size <span className="text-rose-400">*</span>
                      </label>
                      {isFieldRequested('jersey size') && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-amber-500 text-black font-extrabold rounded-full">
                          ⚠️ Required
                        </span>
                      )}
                    </div>
                    <Select
                      options={JERSEY_SIZE_OPTIONS}
                      value={editJerseySize}
                      onChange={(e) => setEditJerseySize(e.target.value)}
                    />
                  </div>
                </div>

                {/* 3. Cricket Profile Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Cricket Role */}
                  <div
                    className={`p-3 rounded-2xl transition-all ${
                      isFieldRequested('role')
                        ? 'bg-amber-950/20 border-2 border-amber-500/60'
                        : 'bg-transparent border border-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-bold text-slate-300">
                        Role <span className="text-rose-400">*</span>
                      </label>
                      {isFieldRequested('role') && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-amber-500 text-black font-extrabold rounded-full">
                          ⚠️ Required
                        </span>
                      )}
                    </div>
                    <Select
                      options={ROLE_OPTIONS}
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value)}
                    />
                  </div>

                  {/* Batting Style */}
                  <div
                    className={`p-3 rounded-2xl transition-all ${
                      isFieldRequested('batting')
                        ? 'bg-amber-950/20 border-2 border-amber-500/60'
                        : 'bg-transparent border border-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-bold text-slate-300">
                        Batting <span className="text-rose-400">*</span>
                      </label>
                      {isFieldRequested('batting') && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-amber-500 text-black font-extrabold rounded-full">
                          ⚠️ Required
                        </span>
                      )}
                    </div>
                    <Select
                      options={BATTING_OPTIONS}
                      value={editBattingStyle}
                      onChange={(e) => setEditBattingStyle(e.target.value)}
                    />
                  </div>

                  {/* Bowling Style */}
                  <div
                    className={`p-3 rounded-2xl transition-all ${
                      isFieldRequested('bowling')
                        ? 'bg-amber-950/20 border-2 border-amber-500/60'
                        : 'bg-transparent border border-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-bold text-slate-300">
                        Bowling
                      </label>
                      {isFieldRequested('bowling') && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-amber-500 text-black font-extrabold rounded-full">
                          ⚠️ Required
                        </span>
                      )}
                    </div>
                    <Select
                      options={BOWLING_OPTIONS}
                      value={editBowlingStyle}
                      onChange={(e) => setEditBowlingStyle(e.target.value)}
                    />
                  </div>
                </div>

                {/* 4. Profile Photo */}
                <div
                  className={`p-4 rounded-2xl transition-all ${
                    isFieldRequested('photo') || isFieldRequested('image')
                      ? 'bg-amber-950/20 border-2 border-amber-500/60'
                      : 'bg-slate-950/60 border border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-300">
                      Profile Photo
                    </span>
                    {(isFieldRequested('photo') || isFieldRequested('image')) && (
                      <span className="text-[10px] px-2 py-0.5 bg-amber-500 text-black font-extrabold rounded-full">
                        ⚠️ Correction Requested
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    {editProfileImage ? (
                      <img
                        src={editProfileImage}
                        alt="Profile preview"
                        className="w-14 h-14 rounded-full object-cover border-2 border-amber-500 shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 shrink-0">
                        <ImageIcon className="w-5 h-5" />
                      </div>
                    )}
                    <div>
                      <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-xl transition-colors border border-slate-700">
                        <Upload className="w-3.5 h-3.5" />
                        <span>Choose Replacement Photo</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={handleProfilePhotoFile}
                        />
                      </label>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Clear passport/front photo (JPG, PNG, WebP)
                      </p>
                    </div>
                  </div>
                </div>

                {/* 5. Payment Screenshot Replacement (When requested or note exists) */}
                {showPaymentScreenshotCorrection && (
                  <div className="p-4 bg-amber-950/30 border-2 border-amber-500/60 rounded-2xl space-y-4">
                    <div className="flex items-center justify-between border-b border-amber-500/30 pb-2">
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-amber-400" />
                        <span className="text-xs font-black text-amber-300 uppercase tracking-wider">
                          Payment Verification Required
                        </span>
                      </div>
                      <span className="text-xs font-bold text-emerald-400">
                        Amount: {feeDisplay}
                      </span>
                    </div>

                    {/* QR Code from tournament config */}
                    <div className="max-w-xs mx-auto">
                      <UPIPaymentChoice
                        upiId={tournamentRecord?.upi_id}
                        payeeName={tournamentRecord?.name || 'FairPlay Premier League'}
                        amountPaise={amountPaise}
                        referenceNote={`Reg ${activeRegistration.registration_number}`}
                        qrUrlFallback={tournamentRecord?.payment_qr_url}
                      />
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-4 pt-2">
                      {editScreenshotBase64 ? (
                        <div className="relative w-20 h-20 rounded-xl overflow-hidden border-2 border-amber-500 shrink-0 bg-slate-900">
                          <img
                            src={editScreenshotBase64}
                            alt="New Screenshot Preview"
                            className="w-full h-full object-contain"
                          />
                        </div>
                      ) : activeRegistration.payment?.payment_screenshot_url ? (
                        <div className="relative w-20 h-20 rounded-xl overflow-hidden border border-slate-700 shrink-0 bg-slate-900">
                          <img
                            src={activeRegistration.payment.payment_screenshot_url}
                            alt="Current Screenshot Preview"
                            className="w-full h-full object-contain"
                          />
                        </div>
                      ) : (
                        <div className="w-20 h-20 rounded-xl bg-slate-800 border border-slate-700 flex flex-col items-center justify-center text-slate-400 text-[10px] shrink-0">
                          <ImageIcon className="w-5 h-5 mb-1" />
                          <span>No file</span>
                        </div>
                      )}

                      <div className="flex-1 text-center sm:text-left space-y-1">
                        <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-xl transition-colors">
                          <Upload className="w-3.5 h-3.5" />
                          <span>{editScreenshotBase64 ? 'Change Selected Screenshot' : 'Upload New Screenshot'}</span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            onChange={handleReplacementScreenshotFile}
                          />
                        </label>
                        <p className="text-[11px] text-slate-400">
                          Attach clear UPI receipt showing UTR / transaction ID
                        </p>
                      </div>
                    </div>

                    <Input
                      label="Transaction Reference / UPI UTR ID"
                      value={editTxnRef}
                      onChange={(e) => setEditTxnRef(e.target.value)}
                      placeholder="e.g. 425612345678"
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={() => setIsEditModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  isLoading={resubmitSubmitting}
                  className="bg-amber-500 hover:bg-amber-400 text-black font-black"
                  leftIcon={<CheckCircle2 className="w-4 h-4 text-black" />}
                >
                  Update & Resubmit
                </Button>
              </div>
            </form>
          </div>
        </Modal>
      </div>
    </section>
  );
};
