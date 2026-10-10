'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/public/Header';
import { Footer } from '@/components/public/Footer';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { formatPaiseToINR, formatDate, cricketRoleLabels } from '@/lib/utils/format';
import { computeDerivedRegistrationStatus } from '@/lib/utils/derived-status';
import { FullPlayerRegistrationProfile, JerseySize } from '@/types';
import {
  Trophy,
  CheckCircle2,
  Clock,
  ArrowLeft,
  Printer,
  ShieldCheck,
  Edit3,
  Upload,
  Image as ImageIcon,
  ShieldAlert,
  Check,
  AlertCircle,
  XCircle,
  Calendar,
} from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { UPIPaymentChoice } from '@/components/ui/UPIPaymentChoice';

export default function RegistrationDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [data, setData] = useState<FullPlayerRegistrationProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Payment Screenshot State
  const [screenshotUrl, setScreenshotUrl] = useState('');
  const [transactionRef, setTransactionRef] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  // Correction State
  const [isCorrectionMode, setIsCorrectionMode] = useState(false);
  const [requestedFields, setRequestedFields] = useState<string[]>([]);
  const [correctionRemark, setCorrectionRemark] = useState('');
  const [correctionRequestedAt, setCorrectionRequestedAt] = useState<string | null>(null);
  const [submittingCorrection, setSubmittingCorrection] = useState(false);
  const [correctionSuccessMsg, setCorrectionSuccessMsg] = useState<string | null>(null);

  // Editable fields
  const [editName, setEditName] = useState('');
  const [editJerseyName, setEditJerseyName] = useState('');
  const [editJerseyNumber, setEditJerseyNumber] = useState('');
  const [editJerseySize, setEditJerseySize] = useState<JerseySize>('M');
  const [editRole, setEditRole] = useState<any>('BATSMAN');
  const [editBattingStyle, setEditBattingStyle] = useState<any>('RIGHT_HAND');
  const [editBowlingStyle, setEditBowlingStyle] = useState('');
  const [editProfileImage, setEditProfileImage] = useState<string>('');

  const fetchRegistrationData = () => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/registrations/${id}`)
      .then((res) => res.json())
      .then((result) => {
        if (result.error) {
          setErrorMsg(result.error);
        } else {
          setData({
            registration: result.registration,
            player: result.player,
            tournament: result.tournament,
            payment: result.latestPayment || null,
          });
          if (result.latestPayment?.transaction_reference) {
            setTransactionRef(result.latestPayment.transaction_reference);
          }
          if (result.latestPayment?.payment_screenshot_url) {
            setScreenshotUrl(result.latestPayment.payment_screenshot_url);
          }

          if (result.registration.registration_status === 'CORRECTION_REQUESTED') {
            setIsCorrectionMode(true);
            const history = result.registration.correction_history || [];
            const activeCorrection = [...history].reverse().find((h: any) => !h.resolved_at) || history[history.length - 1];

            if (activeCorrection) {
              setRequestedFields(activeCorrection.requested_fields || []);
              setCorrectionRemark(activeCorrection.remark || result.registration.admin_remarks || 'Please update your details.');
              setCorrectionRequestedAt(activeCorrection.requested_at || result.registration.correction_requested_at || result.registration.updated_at);
            } else {
              setCorrectionRemark(result.registration.admin_remarks || 'Please update your details.');
              setCorrectionRequestedAt(result.registration.correction_requested_at || result.registration.updated_at);
            }

            // Init editable fields from existing snapshot
            setEditName(result.registration.registered_name_snapshot || '');
            setEditJerseyName(result.registration.registered_jersey_name_snapshot || '');
            setEditJerseyNumber(result.registration.registered_jersey_number_snapshot || '');
            setEditJerseySize(result.registration.registered_jersey_size_snapshot || 'M');
            setEditRole(result.registration.registered_role_snapshot || 'BATSMAN');
            setEditBattingStyle(result.registration.registered_batting_style_snapshot || 'RIGHT_HAND');
            setEditBowlingStyle(result.registration.registered_bowling_style_snapshot || '');
            setEditProfileImage(result.registration.registered_image_snapshot || '');
          } else {
            setIsCorrectionMode(false);
          }
        }
      })
      .catch(() => setErrorMsg('Failed to load registration details'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchRegistrationData();
  }, [id]);

  const handlePrint = () => {
    window.print();
  };

  const compressImage = (file: File, maxWidth = 1000, quality = 0.7): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', quality));
          } else {
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

  const handleScreenshotFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setUploadError('Please select a valid JPG, PNG, or WebP screenshot image');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File size exceeds 10 MB. Please select a smaller screenshot image.');
      return;
    }

    try {
      const compressed = await compressImage(file);
      setScreenshotUrl(compressed);
      setUploadError(null);
    } catch {
      setUploadError('Failed to process image file. Please try another image.');
    }
  };

  const handleProfilePhotoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setErrorMsg('Please select a valid JPG, PNG, or WebP photo');
      return;
    }

    try {
      const compressed = await compressImage(file, 600, 0.8);
      setEditProfileImage(compressed);
    } catch {
      setErrorMsg('Failed to process profile photo');
    }
  };

  const handleSubmitScreenshot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!screenshotUrl) {
      setUploadError('Please upload your payment screenshot before submitting.');
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      const res = await fetch(`/api/registrations/${id}/screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screenshotUrl,
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

      // Redirect immediately to Home page upon successful screenshot submission
      router.push('/?submitted=true');
    } catch {
      setUploadError('Network error uploading screenshot');
      setUploading(false);
    }
  };

  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingCorrection(true);
    setErrorMsg(null);
    setCorrectionSuccessMsg(null);

    const payload: any = {
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

    if (screenshotUrl) {
      payload.screenshot_url = screenshotUrl;
    }

    if (transactionRef) {
      payload.transaction_reference = transactionRef;
    }

    try {
      const res = await fetch(`/api/registrations/${id}/correction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!res.ok || result.error) {
        setErrorMsg(result.error || 'Failed to submit correction');
        setSubmittingCorrection(false);
        return;
      }

      setCorrectionSuccessMsg('Changes resubmitted successfully! Your registration is now under Payment Verification.');
      setSubmittingCorrection(false);

      // Re-fetch data after short delay to show updated status
      setTimeout(() => {
        fetchRegistrationData();
        setCorrectionSuccessMsg(null);
      }, 1500);
    } catch {
      setErrorMsg('Network error submitting correction');
      setSubmittingCorrection(false);
    }
  };

  // Canonical derived status for player UI
  const derivedStatus = data
    ? computeDerivedRegistrationStatus(data.registration, data.payment, data.tournament)
    : null;

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-emerald-500 selection:text-white">
      <Header />

      <main className="flex-1 py-8 sm:py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto space-y-6">
          {loading ? (
            <div className="text-center py-20 text-slate-400">Loading registration details...</div>
          ) : errorMsg && !data ? (
            <Card className="text-center p-8 space-y-3">
              <h2 className="text-xl font-bold text-white">Registration Record Not Found</h2>
              <p className="text-xs text-slate-400">{errorMsg}</p>
            </Card>
          ) : !data ? null : (
            <>
              {/* Action Bar (No Print) */}
              <div className="no-print flex items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg">
                <Link href={`/tournament/${data.tournament.id}`}>
                  <Button variant="secondary" size="sm" leftIcon={<ArrowLeft className="w-4 h-4" />}>
                    Back to Tournament
                  </Button>
                </Link>
                <Button variant="primary" size="sm" onClick={handlePrint} leftIcon={<Printer className="w-4 h-4" />}>
                  Print Receipt
                </Button>
              </div>

              {/* Printable Receipt Card */}
              <div className="printable-receipt-card bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl space-y-8">
                {/* Header */}
                <div className="border-b border-slate-800 pb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shrink-0 shadow-lg">
                      <Trophy className="w-8 h-8" />
                    </div>
                    <div>
                      <h1 className="text-xl sm:text-2xl font-extrabold text-white">
                        {data.tournament.name}
                      </h1>
                      <span className="text-xs text-emerald-400 font-semibold uppercase tracking-wider">
                        Official Tournament Registration Pass
                      </span>
                    </div>
                  </div>

                  <div className="bg-emerald-950/80 border border-emerald-500/40 rounded-2xl px-4 py-2 self-start sm:self-auto">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                      Registration Reference
                    </span>
                    <span className="text-lg font-mono font-extrabold text-emerald-300">
                      {data.registration.registration_number}
                    </span>
                  </div>
                </div>

                {/* AUTHORITATIVE REGISTRATION STATUS HERO BANNER */}
                {derivedStatus && (
                  <div
                    className={`rounded-2xl p-5 border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${derivedStatus.colorClasses.bg} ${derivedStatus.colorClasses.border}`}
                  >
                    <div className="flex items-start gap-3">
                      {derivedStatus.key === 'CONFIRMED' && <CheckCircle2 className="w-7 h-7 text-emerald-400 shrink-0 mt-0.5" />}
                      {derivedStatus.key === 'CORRECTION_REQUIRED' && <AlertCircle className="w-7 h-7 text-amber-400 shrink-0 mt-0.5" />}
                      {derivedStatus.key === 'PAYMENT_PENDING' && <Clock className="w-7 h-7 text-yellow-400 shrink-0 mt-0.5" />}
                      {derivedStatus.key === 'REJECTED' && <XCircle className="w-7 h-7 text-rose-400 shrink-0 mt-0.5" />}
                      {derivedStatus.key === 'WAITLISTED' && <Clock className="w-7 h-7 text-slate-400 shrink-0 mt-0.5" />}
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-base sm:text-lg font-extrabold text-white">
                            {derivedStatus.fullLabel}
                          </h2>
                        </div>
                        <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-xl">
                          {derivedStatus.description}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 self-start sm:self-auto">
                      <span
                        className={`text-xs px-3 py-1.5 rounded-full font-bold uppercase tracking-wider border ${derivedStatus.colorClasses.badgeBg} ${derivedStatus.colorClasses.badgeText} ${derivedStatus.colorClasses.badgeBorder}`}
                      >
                        {derivedStatus.label}
                      </span>
                    </div>
                  </div>
                )}

                {/* CORRECTION REQUIRED DEDICATED PANEL */}
                {isCorrectionMode && (
                  <div className="bg-amber-950/30 border-2 border-amber-500/40 rounded-2xl p-6 shadow-xl space-y-4 no-print">
                    <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 text-amber-400" />
                        <span className="font-extrabold text-amber-300 uppercase tracking-wider text-xs">
                          STATUS: Correction Required
                        </span>
                      </div>
                      {correctionRequestedAt && (
                        <div className="flex items-center gap-1.5 text-xs text-amber-200/80">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>REQUESTED ON: {formatDate(correctionRequestedAt)}</span>
                        </div>
                      )}
                    </div>

                    <div className="bg-slate-950/80 p-4 rounded-xl border border-amber-500/30 text-xs sm:text-sm text-amber-200 space-y-1">
                      <span className="font-bold text-amber-400 uppercase tracking-wider text-[11px] block">
                        ADMIN REMARK:
                      </span>
                      <p className="whitespace-pre-wrap font-medium">{correctionRemark}</p>
                    </div>

                    {requestedFields.length > 0 && (
                      <div className="text-xs">
                        <span className="text-slate-400 font-semibold block mb-1.5">
                          Requested Corrections:
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {requestedFields.map((f) => (
                            <span
                              key={f}
                              className="px-2.5 py-1 bg-amber-950/80 border border-amber-500/50 rounded-lg text-amber-300 font-semibold text-xs"
                            >
                              {f}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {correctionSuccessMsg && (
                      <div className="p-4 bg-emerald-950/80 border border-emerald-500/50 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
                        <Check className="w-5 h-5 text-emerald-400 shrink-0" />
                        <span>{correctionSuccessMsg}</span>
                      </div>
                    )}

                    {errorMsg && (
                      <div className="p-3 bg-rose-950/80 border border-rose-500/50 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                        <span>{errorMsg}</span>
                      </div>
                    )}

                    {/* CORRECTION FORM */}
                    <form onSubmit={handleSubmitCorrection} className="space-y-4 pt-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Player Name */}
                        {(requestedFields.length === 0 || requestedFields.some((f) => /name/i.test(f))) && (
                          <div className={requestedFields.some((f) => /name/i.test(f)) ? 'sm:col-span-2 p-3 bg-amber-950/20 border-2 border-amber-500/60 rounded-2xl' : 'sm:col-span-2'}>
                            {requestedFields.some((f) => /name/i.test(f)) && (
                              <span className="text-[10px] px-2 py-0.5 bg-amber-500 text-black font-extrabold rounded-full mb-1 inline-block">
                                ⚠️ Correction Requested
                              </span>
                            )}
                            <Input
                              label="Player Name *"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              placeholder="Full Player Name"
                              required
                            />
                          </div>
                        )}

                        {/* Jersey Name */}
                        {(requestedFields.length === 0 || requestedFields.includes('Jersey Name')) && (
                          <Input
                            label="Jersey Name *"
                            value={editJerseyName}
                            onChange={(e) => setEditJerseyName(e.target.value)}
                            placeholder="Name on Jersey"
                            required
                          />
                        )}

                        {/* Jersey Number */}
                        {(requestedFields.length === 0 || requestedFields.includes('Jersey Number')) && (
                          <Input
                            label="Jersey Number *"
                            value={editJerseyNumber}
                            onChange={(e) => setEditJerseyNumber(e.target.value)}
                            placeholder="e.g. 10"
                            required
                          />
                        )}

                        {/* Jersey Size */}
                        {(requestedFields.length === 0 || requestedFields.includes('Jersey Size')) && (
                          <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-400">Jersey Size *</label>
                            <select
                              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-amber-500"
                              value={editJerseySize}
                              onChange={(e) => setEditJerseySize(e.target.value as JerseySize)}
                            >
                              <option value="S">Small (S - 38")</option>
                              <option value="M">Medium (M - 40")</option>
                              <option value="L">Large (L - 42")</option>
                              <option value="XL">X-Large (XL - 44")</option>
                              <option value="XXL">XX-Large (XXL - 46")</option>
                              <option value="3XL">3X-Large (3XL - 48")</option>
                            </select>
                          </div>
                        )}

                        {/* Cricket Role */}
                        {(requestedFields.length === 0 || requestedFields.includes('Cricket Role')) && (
                          <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-400">Cricket Role *</label>
                            <select
                              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-amber-500"
                              value={editRole}
                              onChange={(e) => setEditRole(e.target.value)}
                            >
                              <option value="BATSMAN">Batsman</option>
                              <option value="BOWLER">Bowler</option>
                              <option value="ALL_ROUNDER">All-rounder</option>
                              <option value="BATSMAN_WICKETKEEPER">Batsman + Wicketkeeper</option>
                              <option value="BOWLER_WICKETKEEPER">Bowler + Wicketkeeper</option>
                            </select>
                          </div>
                        )}

                        {/* Batting Style */}
                        {(requestedFields.length === 0 || requestedFields.includes('Batting Style')) && (
                          <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-400">Batting Style *</label>
                            <select
                              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-amber-500"
                              value={editBattingStyle}
                              onChange={(e) => setEditBattingStyle(e.target.value)}
                            >
                              <option value="RIGHT_HAND">Right-hand</option>
                              <option value="LEFT_HAND">Left-hand</option>
                            </select>
                          </div>
                        )}

                        {/* Bowling Style */}
                        {(requestedFields.length === 0 || requestedFields.includes('Bowling Style')) && (
                          <Input
                            label="Bowling Style (Optional)"
                            value={editBowlingStyle}
                            onChange={(e) => setEditBowlingStyle(e.target.value)}
                            placeholder="e.g. Right-arm Fast, Off-spin"
                          />
                        )}
                      </div>

                      {/* Profile Photo Upload */}
                      {(requestedFields.length === 0 || requestedFields.includes('Profile Image') || requestedFields.includes('Profile Photo')) && (
                        <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-3">
                          <label className="text-xs font-bold text-slate-400 block">
                            Profile Photo Update
                          </label>
                          <div className="flex items-center gap-4">
                            {editProfileImage ? (
                              <img
                                src={editProfileImage}
                                alt="Updated profile preview"
                                className="w-16 h-16 rounded-full object-cover border-2 border-amber-500 shrink-0"
                              />
                            ) : (
                              <div className="w-16 h-16 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 shrink-0">
                                <ImageIcon className="w-6 h-6" />
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
                              <p className="text-[11px] text-slate-500 mt-1">
                                Clear front-facing photo (JPG, PNG, WebP)
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Payment Screenshot & Reference if flagged or requested */}
                      {(requestedFields.length === 0 ||
                        requestedFields.includes('Payment Screenshot') ||
                        requestedFields.includes('Transaction Reference') ||
                        data.payment?.verification_note) && (
                        <div className="p-4 bg-slate-950/80 border border-amber-500/30 rounded-2xl space-y-4">
                          <div className="flex items-center justify-between border-b border-amber-500/20 pb-2">
                            <span className="text-xs font-bold text-amber-300 block">
                              Payment Verification Required
                            </span>
                            <span className="text-xs font-bold text-emerald-400">
                              Amount: {formatPaiseToINR(data.tournament.registration_fee)}
                            </span>
                          </div>

                          <div className="max-w-xs mx-auto">
                            <UPIPaymentChoice
                              upiId={data.tournament.upi_id}
                              payeeName={data.tournament.name}
                              amountPaise={data.tournament.registration_fee}
                              referenceNote={`Reg ${data.registration.registration_number}`}
                              qrUrlFallback={data.tournament.payment_qr_url}
                            />
                          </div>

                          <div className="flex flex-col sm:flex-row items-center gap-4">
                            {screenshotUrl ? (
                              <div className="relative w-20 h-20 rounded-xl overflow-hidden border-2 border-amber-500 shrink-0 bg-slate-900">
                                <img
                                  src={screenshotUrl}
                                  alt="Payment Screenshot Preview"
                                  className="w-full h-full object-contain"
                                />
                              </div>
                            ) : (
                              <div className="w-20 h-20 rounded-xl bg-slate-800 border border-slate-700 flex flex-col items-center justify-center text-slate-500 text-[10px] shrink-0">
                                <ImageIcon className="w-6 h-6 text-slate-400 mb-1" />
                                <span>No Screenshot</span>
                              </div>
                            )}
                            <div className="flex-1 text-center sm:text-left">
                              <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-xl transition-colors">
                                <Upload className="w-3.5 h-3.5" />
                                <span>{screenshotUrl ? 'Change Screenshot' : 'Upload Payment Screenshot'}</span>
                                <input
                                  type="file"
                                  accept="image/jpeg,image/png,image/webp"
                                  className="hidden"
                                  onChange={handleScreenshotFile}
                                />
                              </label>
                              <p className="text-[11px] text-slate-400 mt-1">
                                Attach clear receipt showing UPI reference ID and date
                              </p>
                            </div>
                          </div>
                          <Input
                            label="Transaction Reference / UPI UTR ID"
                            value={transactionRef}
                            onChange={(e) => setTransactionRef(e.target.value)}
                            placeholder="e.g. 425612345678"
                          />
                        </div>
                      )}

                      <div className="flex justify-end pt-3">
                        <Button
                          type="submit"
                          size="lg"
                          isLoading={submittingCorrection}
                          className="bg-amber-500 hover:bg-amber-400 text-black font-extrabold px-6"
                          leftIcon={<CheckCircle2 className="w-5 h-5 text-black" />}
                        >
                          ACTION: Update & Resubmit
                        </Button>
                      </div>
                    </form>
                  </div>
                )}

                {/* Player Profile Snapshot Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs sm:text-sm">
                  <div className="space-y-3 bg-slate-950/60 border border-slate-800 rounded-2xl p-4">
                    <h4 className="font-bold text-emerald-400 uppercase tracking-wider text-xs border-b border-slate-800 pb-2">
                      Registered Player Snapshot
                    </h4>
                    <div className="flex items-center gap-4 py-2 border-b border-slate-900">
                      {data.registration.registered_image_snapshot ? (
                        <img
                          src={data.registration.registered_image_snapshot}
                          alt="Snapshot"
                          className="w-14 h-14 rounded-full object-cover border border-emerald-500 shrink-0"
                        />
                      ) : null}
                      <div>
                        <span className="text-slate-400 text-xs block">Player Name</span>
                        <span className="font-bold text-white text-base">
                          {data.registration.registered_name_snapshot}
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-400">Email:</span>
                      <span className="font-semibold text-slate-200">{data.player.email}</span>
                    </div>
                  </div>

                  <div className="space-y-3 bg-slate-950/60 border border-slate-800 rounded-2xl p-4">
                    <h4 className="font-bold text-emerald-400 uppercase tracking-wider text-xs border-b border-slate-800 pb-2">
                      Cricket & Jersey Attributes
                    </h4>
                    <div className="flex justify-between py-1 border-b border-slate-900">
                      <span className="text-slate-400">Primary Role:</span>
                      <span className="font-bold text-emerald-300">
                        {cricketRoleLabels[data.registration.registered_role_snapshot]}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-900">
                      <span className="text-slate-400">Batting Style:</span>
                      <span className="font-semibold text-slate-200">
                        {data.registration.registered_batting_style_snapshot
                          ? data.registration.registered_batting_style_snapshot.replace('_', ' ')
                          : 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-900">
                      <span className="text-slate-400">Bowling Style:</span>
                      <span className="font-semibold text-slate-200">
                        {data.registration.registered_bowling_style_snapshot || 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-900">
                      <span className="text-slate-400">Jersey Name:</span>
                      <span className="font-bold text-white">
                        {data.registration.registered_jersey_name_snapshot || 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-900">
                      <span className="text-slate-400">Jersey Number:</span>
                      <span className="font-bold text-amber-300">
                        {data.registration.registered_jersey_number_snapshot || 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-900">
                      <span className="text-slate-400">Jersey Size:</span>
                      <span className="font-bold text-emerald-400">
                        {data.registration.registered_jersey_size_snapshot || data.player.jersey_size || 'M'}
                      </span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-400">Registered Date:</span>
                      <span className="font-semibold text-slate-200">
                        {formatDate(data.registration.registered_at)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Manual UPI Payment Instructions & QR Display */}
                {data.tournament.payment_enabled && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between bg-slate-900 border border-slate-800 p-4 rounded-2xl">
                      <span className="text-xs font-bold text-slate-400">Payment Status:</span>
                      <span
                        className={`text-xs px-3 py-1 rounded-full font-bold uppercase tracking-wider border ${
                          data.payment?.payment_status === 'SUCCESSFUL'
                            ? 'bg-emerald-950 border-emerald-500/50 text-emerald-400'
                            : 'bg-yellow-950 border-yellow-500/50 text-yellow-400'
                        }`}
                      >
                        {data.payment?.payment_status === 'SUCCESSFUL' ? 'Paid (Verified)' : 'Pending Verification'}
                      </span>
                    </div>

                    <UPIPaymentChoice
                      upiId={data.tournament.upi_id}
                      payeeName={data.tournament.name}
                      amountPaise={data.tournament.registration_fee}
                      referenceNote={`Reg ${data.registration.registration_number}`}
                      qrUrlFallback={data.tournament.payment_qr_url}
                    />

                    {/* PAYMENT SCREENSHOT UPLOAD FORM (When not already confirmed) */}
                    {data.payment?.payment_status !== 'SUCCESSFUL' && !isCorrectionMode && (
                      <div className="pt-4 border-t border-slate-800 space-y-4 no-print">
                        <div className="space-y-1">
                          <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider block">
                            Step 1: Automated Payment Screenshot Verification
                          </span>
                          <h4 className="font-bold text-white text-base">Upload Payment Receipt Screenshot</h4>
                          <p className="text-xs text-slate-400">
                            Upload your UPI payment screenshot (GPay / PhonePe / Paytm / BHIM) after sending{' '}
                            {formatPaiseToINR(data.tournament.registration_fee)}.
                          </p>
                        </div>

                        {data.payment?.verification_note && (
                          <div className="p-4 bg-amber-950/90 border border-amber-500/50 rounded-2xl text-amber-200 text-xs sm:text-sm space-y-2 shadow-xl animate-fadeIn">
                            <div className="flex items-center gap-2 font-bold text-amber-400 text-sm">
                              <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
                              <span>Payment Verification Note</span>
                            </div>
                            <p className="text-amber-200 bg-slate-950/80 p-3 rounded-xl border border-amber-500/30 text-xs mt-1">
                              {data.payment.verification_note}
                            </p>
                          </div>
                        )}

                        {uploadError && (
                          <div className="p-3 bg-rose-950/80 border border-rose-500/50 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                            <span>{uploadError}</span>
                          </div>
                        )}

                        {uploadSuccess && (
                          <div className="p-4 bg-emerald-950/90 border border-emerald-500/50 rounded-2xl text-emerald-300 text-xs sm:text-sm flex items-start gap-3 shadow-xl animate-fadeIn">
                            <Check className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                            <div>
                              <span className="font-bold text-white block">Screenshot Submitted! ✔️</span>
                              <p>Screenshot updated. Awaiting Admin payment verification...</p>
                            </div>
                          </div>
                        )}

                        <form onSubmit={handleSubmitScreenshot} className="space-y-4">
                          <div className="flex flex-col sm:flex-row items-center gap-4 p-4 bg-slate-950/90 border border-dashed border-slate-700 rounded-2xl">
                            {screenshotUrl ? (
                              <div className="relative w-24 h-24 rounded-xl overflow-hidden border-2 border-emerald-500 shrink-0 bg-slate-900">
                                <img
                                  src={screenshotUrl}
                                  alt="Payment Screenshot Preview"
                                  className="w-full h-full object-contain"
                                />
                              </div>
                            ) : (
                              <div className="w-24 h-24 rounded-xl bg-slate-800 border border-slate-700 flex flex-col items-center justify-center text-slate-500 text-[10px] shrink-0">
                                <ImageIcon className="w-8 h-8 text-slate-400 mb-1" />
                                <span>No Screenshot</span>
                              </div>
                            )}
                            <div className="flex-1 text-center sm:text-left space-y-1">
                              <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-semibold rounded-xl transition-colors shadow-lg">
                                <Upload className="w-4 h-4" />
                                <span>{screenshotUrl ? 'Change Screenshot' : 'Choose Payment Screenshot'}</span>
                                <input
                                  type="file"
                                  accept="image/jpeg,image/png,image/webp"
                                  className="hidden"
                                  onChange={handleScreenshotFile}
                                />
                              </label>
                              <p className="text-[11px] text-slate-400">
                                Attach JPG, PNG or WebP receipt screenshot from GPay, PhonePe, Paytm, etc. (Max 10 MB)
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
                              helperText="Step 1 Automated Check verifies transaction date"
                            />
                          </div>

                          <div className="pt-2 flex justify-end">
                            <Button
                              type="submit"
                              size="lg"
                              isLoading={uploading}
                              disabled={!screenshotUrl || uploadSuccess}
                              leftIcon={<CheckCircle2 className="w-5 h-5 text-emerald-300" />}
                              className="w-full sm:w-auto"
                            >
                              Submit Screenshot for Verification
                            </Button>
                          </div>
                        </form>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
