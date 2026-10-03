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
import { FullPlayerRegistrationProfile, JerseySize } from '@/types';
import { Trophy, CheckCircle2, Clock, QrCode, ArrowLeft, Printer, ShieldCheck, Edit3, Upload, Image as ImageIcon, ShieldAlert, Check, AlertCircle } from 'lucide-react';
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
  const [submittingCorrection, setSubmittingCorrection] = useState(false);

  // Editable fields
  const [editJerseyName, setEditJerseyName] = useState('');
  const [editJerseyNumber, setEditJerseyNumber] = useState('');
  const [editJerseySize, setEditJerseySize] = useState<JerseySize>('M');
  const [editRole, setEditRole] = useState<any>('BATSMAN');
  const [editBattingStyle, setEditBattingStyle] = useState<any>('RIGHT_HAND');
  const [editBowlingStyle, setEditBowlingStyle] = useState('');

  useEffect(() => {
    if (!id) return;

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
            const activeCorrection = history.find((h: any) => !h.resolved_at);
            if (activeCorrection) {
              setRequestedFields(activeCorrection.requested_fields || []);
              setCorrectionRemark(activeCorrection.remark || result.registration.admin_remarks || '');
            } else {
              setCorrectionRemark(result.registration.admin_remarks || 'Please update your details');
            }
            
            // Init editable fields
            setEditJerseyName(result.registration.registered_jersey_name_snapshot || '');
            setEditJerseyNumber(result.registration.registered_jersey_number_snapshot || '');
            setEditJerseySize(result.registration.registered_jersey_size_snapshot || 'M');
            setEditRole(result.registration.registered_role_snapshot || 'BATSMAN');
            setEditBattingStyle(result.registration.registered_batting_style_snapshot || 'RIGHT_HAND');
            setEditBowlingStyle(result.registration.registered_bowling_style_snapshot || '');
          }
        }
      })
      .catch(() => setErrorMsg('Failed to load registration details'))
      .finally(() => setLoading(false));
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

      // Redirect to Home Page after 1st Step Automated Validation passes
      setTimeout(() => {
        const tName = data?.tournament?.name || 'Tournament';
        router.push(`/?submitted=true&tName=${encodeURIComponent(tName)}`);
      }, 1200);
    } catch (err: any) {
      setUploadError('Network error uploading screenshot');
      setUploading(false);
    }
  };

  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingCorrection(true);
    setErrorMsg(null);

    const payload: any = {};
    if (requestedFields.includes('Jersey Name')) payload.jersey_name = editJerseyName;
    if (requestedFields.includes('Jersey Number')) payload.jersey_number = editJerseyNumber;
    if (requestedFields.includes('Jersey Size')) payload.jersey_size = editJerseySize;
    if (requestedFields.includes('Cricket Role')) payload.cricket_role = editRole;
    if (requestedFields.includes('Batting Style')) payload.batting_style = editBattingStyle;
    if (requestedFields.includes('Bowling Style')) payload.bowling_style = editBowlingStyle;

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
      
      // Reload page to see updated state
      window.location.reload();
    } catch (err: any) {
      setErrorMsg('Network error submitting correction');
      setSubmittingCorrection(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-emerald-500 selection:text-white">
      <Header />

      <main className="flex-1 py-8 sm:py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto space-y-6">
          {loading ? (
            <div className="text-center py-20 text-slate-400">Loading registration details...</div>
          ) : errorMsg || !data ? (
            <Card className="text-center p-8 space-y-3">
              <h2 className="text-xl font-bold text-white">Registration Record Not Found</h2>
              <p className="text-xs text-slate-400">{errorMsg}</p>
            </Card>
          ) : (
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

                {/* Registration Status Banner */}
                {data.registration.registration_status === 'CONFIRMED' ? (
                  <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-2xl p-4 flex items-center gap-3">
                    <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
                    <div>
                      <h3 className="text-sm font-bold text-emerald-300">Slot Confirmed 🎉</h3>
                      <p className="text-xs text-slate-300">
                        Regular tournament slot assigned. Complete payment below to finalize entry.
                      </p>
                    </div>
                  </div>
                ) : data.registration.registration_status === 'CORRECTION_REQUESTED' ? (
                  <div className="bg-amber-950/40 border border-amber-500/30 rounded-2xl p-4 flex items-start gap-3">
                    <AlertCircle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <h3 className="text-sm font-bold text-amber-300">CORRECTION REQUIRED</h3>
                      <div className="mt-2 p-3 bg-slate-950/60 rounded-xl border border-amber-500/20 text-xs text-amber-200">
                        <span className="font-semibold block mb-1">Admin Message:</span>
                        {correctionRemark}
                      </div>
                      {requestedFields.length > 0 && (
                        <div className="mt-3">
                          <span className="text-xs font-semibold text-slate-400 block mb-1">Requested Fields:</span>
                          <div className="flex flex-wrap gap-2">
                            {requestedFields.map(f => (
                              <span key={f} className="text-xs px-2 py-1 bg-amber-950/60 border border-amber-500/40 rounded text-amber-300">
                                {f}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="bg-sky-950/40 border border-sky-500/30 rounded-2xl p-4 flex items-center gap-3">
                    <Clock className="w-6 h-6 text-sky-400 shrink-0" />
                    <div>
                      <h3 className="text-sm font-bold text-sky-300">
                        Waitlist Position #{data.registration.waitlist_position || 1}
                      </h3>
                      <p className="text-xs text-slate-300">
                        Tournament regular slots are currently full. You will be automatically promoted if a slot opens!
                      </p>
                    </div>
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
                      Cricket Attributes
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
                      <span className="text-slate-400">Jersey Size:</span>
                      <span className="font-bold text-amber-400">
                        {data.registration.registered_jersey_size_snapshot || data.player.jersey_size || 'M'}
                      </span>
                    </div>
                    {(data.registration.registered_jersey_number_snapshot || data.registration.registered_jersey_name_snapshot) && (
                      <div className="flex justify-between py-1 border-b border-slate-900">
                        <span className="text-slate-400">Jersey Name / No:</span>
                        <span className="font-bold text-white">
                          {data.registration.registered_jersey_name_snapshot || ''} {data.registration.registered_jersey_number_snapshot ? `#${data.registration.registered_jersey_number_snapshot}` : ''}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between py-1">
                      <span className="text-slate-400">Registered Date:</span>
                      <span className="font-semibold text-slate-200">
                        {formatDate(data.registration.registered_at)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* CORRECTION FORM */}
                {isCorrectionMode && requestedFields.length > 0 && (
                  <div className="bg-amber-950/20 border border-amber-500/30 rounded-2xl p-6 shadow-lg no-print">
                    <h3 className="text-lg font-bold text-amber-400 mb-4 flex items-center gap-2">
                      <Edit3 className="w-5 h-5" />
                      Update Requested Details
                    </h3>
                    <form onSubmit={handleSubmitCorrection} className="space-y-4">
                      {requestedFields.includes('Jersey Name') && (
                        <Input
                          label="Jersey Name"
                          value={editJerseyName}
                          onChange={(e) => setEditJerseyName(e.target.value)}
                          placeholder="Name on Jersey"
                          required
                        />
                      )}
                      {requestedFields.includes('Jersey Number') && (
                        <Input
                          label="Jersey Number"
                          value={editJerseyNumber}
                          onChange={(e) => setEditJerseyNumber(e.target.value)}
                          placeholder="e.g. 10"
                          required
                        />
                      )}
                      {requestedFields.includes('Jersey Size') && (
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-slate-400">Jersey Size</label>
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
                      {requestedFields.includes('Cricket Role') && (
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-slate-400">Cricket Role</label>
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
                      {requestedFields.includes('Batting Style') && (
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-slate-400">Batting Style</label>
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
                      
                      <div className="flex justify-end pt-4">
                        <Button 
                          type="submit" 
                          isLoading={submittingCorrection} 
                          className="bg-amber-500 hover:bg-amber-600 text-black font-bold"
                          leftIcon={<CheckCircle2 className="w-5 h-5" />}
                        >
                          Submit Correction
                        </Button>
                      </div>
                    </form>
                  </div>
                )}

                {/* Manual UPI Payment Instructions & QR Display */}
                {data.tournament.payment_enabled && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between bg-slate-900 border border-slate-800 p-4 rounded-2xl">
                      <span className="text-xs font-bold text-slate-400">Payment Verification Status:</span>
                      <Badge status={data.payment?.payment_status || 'PENDING'}>
                        {data.payment?.payment_status === 'SUCCESSFUL' ? 'Paid (Verified)' : 'Pending Verification'}
                      </Badge>
                    </div>

                    <UPIPaymentChoice
                      upiId={data.tournament.upi_id}
                      payeeName={data.tournament.name}
                      amountPaise={data.tournament.registration_fee}
                      referenceNote={`Reg ${data.registration.registration_number}`}
                      qrUrlFallback={data.tournament.payment_qr_url}
                    />

                    {/* PAYMENT SCREENSHOT UPLOAD FORM (STEP 1 AUTOMATED VERIFICATION) */}
                    <div className="pt-4 border-t border-slate-800 space-y-4 no-print">
                      <div className="space-y-1">
                        <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider block">
                          Step 1: Automated Payment Screenshot Verification
                        </span>
                        <h4 className="font-bold text-white text-base">Upload Payment Receipt Screenshot</h4>
                        <p className="text-xs text-slate-400">
                          Upload your UPI payment screenshot (GPay / PhonePe / Paytm / BHIM) after sending {formatPaiseToINR(data.tournament.registration_fee)}.
                        </p>
                      </div>

                      {/* ADMIN RE-UPLOAD REQUEST REASON BANNER */}
                      {data.payment?.verification_note && (data.payment.payment_status === 'PENDING' || (data.registration.registration_status as string) === 'CORRECTION_REQUESTED') && (
                        <div className="p-4 bg-amber-950/90 border border-amber-500/50 rounded-2xl text-amber-200 text-xs sm:text-sm space-y-2 shadow-xl animate-fadeIn">
                          <div className="flex items-center gap-2 font-bold text-amber-400 text-sm">
                            <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
                            <span>Payment Verification Required</span>
                          </div>
                          <div>
                            <span className="font-semibold block text-slate-200 text-xs">Reason:</span>
                            <p className="text-amber-200 bg-slate-950/80 p-3 rounded-xl border border-amber-500/30 text-xs mt-1">
                              {data.payment.verification_note}
                            </p>
                          </div>
                          <p className="text-[11px] text-amber-300/80">
                            Please attach a clear payment receipt screenshot showing the full transaction reference and date below.
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
                            <span className="font-bold text-white block">Step 1 Validation Passed! ✔️</span>
                            <p>Screenshot verified. Redirecting to Home Page where your entry is under Admin review...</p>
                          </div>
                        </div>
                      )}

                      <form onSubmit={handleSubmitScreenshot} className="space-y-4">
                        <div className="flex flex-col sm:flex-row items-center gap-4 p-4 bg-slate-950/90 border border-dashed border-slate-700 rounded-2xl">
                          {screenshotUrl ? (
                            <div className="relative w-24 h-24 rounded-xl overflow-hidden border-2 border-emerald-500 shrink-0 bg-slate-900">
                              <img src={screenshotUrl} alt="Payment Screenshot Preview" className="w-full h-full object-contain" />
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
                              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleScreenshotFile} />
                            </label>
                            <p className="text-[11px] text-slate-400">
                              Attach JPG, PNG or WebP receipt screenshot from GPay, PhonePe, Paytm, etc. (Max 5 MB)
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
                            Submit Screenshot & Return to Home Page
                          </Button>
                        </div>
                      </form>
                    </div>
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
