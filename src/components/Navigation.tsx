'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { SyncBadge } from './SyncManager';

const LINKS = [
  { href: '/', label: 'Tableau de bord', short: 'Accueil' },
  { href: '/analytics', label: 'Analytiques', short: 'Stats' },
  { href: '/donnees', label: 'Données', short: 'Données' },
  { href: '/batch/new', label: '+ Nouveau batch', short: '+ Batch' },
];

export default function Navigation() {
  const pathname = usePathname();
  const { data: session } = useSession();

  if (pathname === '/login') return null;

  return (
    <nav className="sticky top-0 z-40 bg-brand-800 shadow-md print:hidden">
      <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-2">
          <Link href="/" className="flex items-center gap-2 shrink-0" aria-label="HydroLoop — tableau de bord">
            <LeafIcon />
            <span className="text-white font-bold text-lg tracking-tight hidden min-[400px]:inline">
              HydroLoop<sup className="text-xs font-normal">™</sup>
            </span>
          </Link>

          <div className="flex items-center gap-0.5 sm:gap-1 min-w-0 overflow-x-auto">
            {LINKS.map((l) => {
              const on = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={on ? 'page' : undefined}
                  className={`px-2 sm:px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap
                    ${on ? 'bg-brand-600 text-white' : 'text-brand-100 hover:bg-brand-700 hover:text-white'}`}
                >
                  <span className="hidden md:inline">{l.label}</span>
                  <span className="md:hidden">{l.short}</span>
                </Link>
              );
            })}

            <SyncBadge />

            {session && (
              <div className="flex items-center gap-2 ml-1 shrink-0">
                <span className="hidden lg:inline text-brand-300 text-xs">{session.user?.name}</span>
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="text-brand-200 hover:text-white text-xs px-2 py-1 rounded hover:bg-brand-700 transition-colors"
                  title="Déconnexion"
                  aria-label="Déconnexion"
                >
                  ⏏
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

function LeafIcon() {
  return (
    <svg className="w-7 h-7 text-brand-300 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17 8C8 10 5.9 16.17 3.82 21.34L5.71 22l1-2.3A4.49 4.49 0 008 20C19 20 22 3 22 3c-1 2-8 1-13 4S2 22 2 22c0-8 4-18 15-14z" />
    </svg>
  );
}
