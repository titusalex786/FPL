'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import {
  Trophy,
  LayoutDashboard,
  Users,
  FileText,
  Settings,
  LogOut,
  Menu,
  X,
  Loader2,
  ShieldCheck,
  Home,
  ArrowLeft,
  Gavel,
} from 'lucide-react';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [adminUser, setAdminUser] = useState<{ email: string; name: string } | null>(null);

  useEffect(() => {
    if (pathname === '/admin/login') {
      setCheckingAuth(false);
      return;
    }

    async function verifyAdmin() {
      try {
        const res = await fetch('/api/admin/me');
        const data = await res.json();
        if (res.ok && data.isAdmin) {
          setAdminUser(data.user);
          setCheckingAuth(false);
        } else {
          router.replace('/admin/login');
        }
      } catch (err) {
        router.replace('/admin/login');
      }
    }

    verifyAdmin();
  }, [pathname, router]);

  // If on login page, render children directly
  if (pathname === '/admin/login') {
    return <>{children}</>;
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
        <span className="text-sm font-medium">Verifying Admin Authorization...</span>
      </div>
    );
  }

  const navItems = [
    { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
    { label: 'Player Directory', href: '/admin/players', icon: Users },
    { label: 'Auctions', href: '/manager/auctions', icon: Gavel },
    { label: 'Audit Logs', href: '/admin/audit-logs', icon: FileText },
    { label: 'Settings', href: '/admin/settings', icon: Settings },
  ];

  const handleLogout = async () => {
    await fetch('/api/admin/login', { method: 'DELETE' }).catch(() => {});
    router.push('/admin/login');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col md:flex-row selection:bg-emerald-500 selection:text-white">
      {/* Mobile Header Bar */}
      <div className="md:hidden sticky top-0 z-40 bg-slate-900 border-b border-slate-800 p-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold">
            <Trophy className="w-4 h-4" />
          </div>
          <span className="font-bold text-sm text-white">Admin Console</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/" className="p-2 rounded-lg text-slate-300 hover:bg-slate-800 focus:outline-none flex items-center gap-1 text-xs font-semibold">
            <ArrowLeft className="w-4 h-4 text-emerald-400" />
            <span>Home</span>
          </Link>
          <button
            onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
            className="p-2 rounded-lg text-slate-300 hover:bg-slate-800 focus:outline-none"
          >
            {mobileSidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Overlay */}
      {mobileSidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-slate-950/80 backdrop-blur-sm"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Desktop Sidebar / Mobile Drawer */}
      <aside
        className={clsx(
          'fixed md:static inset-y-0 left-0 z-40 w-64 bg-slate-900 border-r border-slate-800/80 p-5 flex flex-col justify-between transition-transform duration-300 md:translate-x-0',
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="space-y-6">
          {/* Logo & Back to website link */}
          <Link href="/" className="flex items-center gap-3 pb-4 border-b border-slate-800 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md group-hover:scale-105 transition-transform">
              <Trophy className="w-6 h-6" />
            </div>
            <div>
              <span className="font-extrabold text-base text-white block group-hover:text-emerald-400 transition-colors">Premier Cricket</span>
              <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider block">
                Admin Console
              </span>
            </div>
          </Link>

          {/* Navigation */}
          <nav className="space-y-1">
            <Link
              href="/"
              onClick={() => setMobileSidebarOpen(false)}
              className="flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-xs sm:text-sm bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-500/40 mb-3 transition-colors"
            >
              <Home className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>← Back to Website Home</span>
            </Link>

            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileSidebarOpen(false)}
                  className={clsx(
                    'flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-xs sm:text-sm transition-colors',
                    isActive
                      ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
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
            <div className="w-8 h-8 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-500/40 flex items-center justify-center font-bold text-xs shrink-0">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="overflow-hidden">
              <span className="font-semibold text-xs text-white block truncate">
                {adminUser?.name || 'Administrator'}
              </span>
              <span className="text-[10px] text-slate-400 block truncate">
                {adminUser?.email || 'atulpawar07@gmail.com'}
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
      <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">
        <div className="max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
