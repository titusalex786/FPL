'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatPaiseToINR, formatDate } from '@/lib/utils/format';
import { DbTournament } from '@/types';
import {
  Trophy,
  Users,
  CheckCircle2,
  Clock,
  Briefcase,
  ChevronRight,
  ShieldCheck,
  Loader2,
} from 'lucide-react';

export default function ManagerDashboardPage() {
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/dashboard')
      .then((res) => res.json())
      .then((resData) => {
        if (resData.tournaments) {
          setTournaments(resData.tournaments);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center text-slate-400 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
        <span>Loading manager workspace...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Top Banner */}
      <div className="border-b border-slate-800 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="px-2.5 py-1 rounded-full bg-teal-950 border border-teal-500/40 text-teal-300 font-bold text-xs flex items-center gap-1.5">
            <Briefcase className="w-3.5 h-3.5" />
            Manager Delegation Access
          </span>
          <Link
            href="/manager/auctions/new"
            className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-teal-400"
          >
            Create auction
          </Link>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white mt-2">Manager Portal</h1>
        <p className="text-xs sm:text-sm text-slate-400 mt-1">
          Authorized to approve player registrations and verify payments on behalf of Super Admin.
        </p>
      </div>

      {/* Tournaments list to manage */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-400" />
          Active Tournaments ({tournaments.length})
        </h2>

        {tournaments.length === 0 ? (
          <Card className="text-center p-8 text-slate-400">
            No active tournaments found. Please contact Super Admin.
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {tournaments.map((t) => (
              <Card key={t.id} className="space-y-4 border border-slate-800 hover:border-teal-500/50 transition-all flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-extrabold text-white text-lg">{t.name}</h3>
                    <Badge status={t.registration_open ? 'ACTIVE' : 'INACTIVE'}>
                      {t.registration_open ? 'Open' : 'Closed'}
                    </Badge>
                  </div>

                  <p className="text-xs text-slate-400 line-clamp-2">
                    {t.description || 'Official Premier League Cricket Tournament.'}
                  </p>

                  <div className="grid grid-cols-2 gap-2 text-xs bg-slate-950 p-3 rounded-xl border border-slate-850">
                    <div>
                      <span className="text-slate-500 text-[10px] block">Registered</span>
                      <span className="font-bold text-teal-400">{t.stats?.totalRegistered || 0}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">Pending Reviews</span>
                      <span className="font-bold text-amber-400">{t.stats?.pendingPayments || 0}</span>
                    </div>
                  </div>
                </div>

                <Link href={`/manager/tournament/${t.id}`}>
                  <Button variant="primary" size="sm" className="w-full" rightIcon={<ChevronRight className="w-4 h-4" />}>
                    Open Approval Workspace
                  </Button>
                </Link>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
