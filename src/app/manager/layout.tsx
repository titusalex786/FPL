'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import {
  Trophy,
  Briefcase,
  Users,
  CheckSquare,
  DollarSign,
  LogOut,
  Menu,
  X,
  Loader2,
  ShieldCheck,
  Gavel,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export default function ManagerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [managerUser, setManagerUser] = useState<{ email: string; name: string; isAdmin: boolean } | null>(null);

  useEffect(() => {
    if (pathname === '/manager/login') {
      setCheckingAuth(false);
      return;
    }

    async function verifyManager() {
      try {
        const res = await fetch('/api/manager/me');
        const data = await res.json();
        if (res.ok && data.isManager) {
          setManagerUser({
            email: data.user.email,
            name: data.user.name,
            isAdmin: data.isAdmin,
          });
          setCheckingAuth(false);
        } else {
          router.replace('/auth/login?redirect=/manager');
        }
      } catch (err) {
        router.replace('/auth/login?redirect=/manager');
      }
    }

    verifyManager();
  }, [pathname, router]);

  if (pathname === '/manager/login') {
    return <>{children}</>;
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
        <span className="text-sm font-medium">Verifying Manager Authorization...</span>
      </div>
    );
  }

  const navItems = [
    { label: 'Manager Dashboard', href: '/manager', icon: Briefcase },
    { label: 'Auctions', href: '/manager/auctions', icon: Gavel },
  ];

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col md:flex-row selection:bg-teal-500 selection:text-white">
      {/* Mobile Header */}
      <div className="md:hidden sticky top-0 z-40 bg-slate-900 border-b border-slate-800 p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center text-white font-bold">
            <Briefcase className="w-4 h-4" />
          </div>
          <span className="font-bold text-sm text-white">Manager Portal</span>
        </div>
        <button
          onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
          className="p-2 rounded-lg text-slate-300 hover:bg-slate-800 focus:outline-none"
        >
          {mobileSidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Desktop Sidebar */}
      <aside
        className={clsx(
          'fixed md:static inset-y-0 left-0 z-40 w-64 bg-slate-900 border-r border-slate-800/80 p-5 flex flex-col justify-between transition-transform duration-300 md:translate-x-0',
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-slate-800">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-teal-600 to-emerald-500 flex items-center justify-center text-white shadow-md">
              <Briefcase className="w-6 h-6" />
            </div>
            <div>
              <span className="font-extrabold text-base text-white block">Premier Cricket</span>
              <span className="text-[10px] text-teal-400 font-bold uppercase tracking-wider block">
                Manager Console
              </span>
            </div>
          </div>

          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href || (item.href !== '/manager' && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileSidebarOpen(false)}
                  className={clsx(
                    'flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-xs sm:text-sm transition-colors',
                    isActive
                      ? 'bg-teal-600/20 text-teal-400 border border-teal-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* User Footer */}
        <div className="pt-4 border-t border-slate-800 space-y-3">
          <div className="flex items-center gap-3 px-2">
            <div className="w-8 h-8 rounded-full bg-teal-950 text-teal-400 border border-teal-500/40 flex items-center justify-center font-bold text-xs shrink-0">
              <Briefcase className="w-4 h-4" />
            </div>
            <div className="overflow-hidden">
              <span className="font-semibold text-xs text-white block truncate">
                {managerUser?.name || 'Authorized Manager'}
              </span>
              <span className="text-[10px] text-teal-400 block font-semibold truncate">
                Granted by Admin
              </span>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-slate-800/80 hover:bg-rose-950/40 text-slate-300 hover:text-rose-400 border border-slate-700/60 hover:border-rose-500/30 rounded-xl text-xs font-semibold transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-3 sm:p-5 lg:p-6 overflow-y-auto">
        <div className="w-full mx-auto max-w-[1800px]">{children}</div>
      </main>
    </div>
  );
}
