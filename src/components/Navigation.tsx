'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { isCloudEnabled } from '@/lib/supabase';

export default function Navigation() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const cloudEnabled = isCloudEnabled();

  const links = [
    { href: '/', label: 'Tableau de bord' },
    { href: '/analytics', label: 'Analytiques' },
    { href: '/batch/new', label: '+ Nouveau Batch' },
  ];

  return (
    <nav className="sticky top-0 z-50 bg-brand-800 shadow-md print:hidden">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <LeafIcon />
            <span className="text-white font-bold text-lg tracking-tight">
              HydroLoop<sup className="text-xs font-normal">™</sup>
            </span>
            <span className="hidden md:inline text-brand-300 text-xs font-medium">
              A-Frame NFT
            </span>
          </Link>

          <div className="flex items-center gap-1 flex-wrap justify-end">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap
                  ${pathname === l.href
                    ? 'bg-brand-600 text-white'
                    : 'text-brand-100 hover:bg-brand-700 hover:text-white'
                  }`}
              >
                {l.label}
              </Link>
            ))}

            {/* Cloud indicator */}
            {cloudEnabled && (
              <span className="hidden sm:inline text-xs text-brand-300 px-2" title="Supabase sync actif">
                ☁️
              </span>
            )}

            {/* Auth section */}
            {session ? (
              <div className="flex items-center gap-2 ml-1">
                <span className="hidden sm:inline text-brand-300 text-xs">{session.user?.name}</span>
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="text-brand-200 hover:text-white text-xs px-2 py-1 rounded hover:bg-brand-700 transition-colors"
                  title="Déconnexion"
                >
                  ⏏
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </nav>
  );
}

function LeafIcon() {
  return (
    <svg className="w-7 h-7 text-brand-300 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 8C8 10 5.9 16.17 3.82 21.34L5.71 22l1-2.3A4.49 4.49 0 008 20C19 20 22 3 22 3c-1 2-8 1-13 4S2 22 2 22c0-8 4-18 15-14z" />
    </svg>
  );
}
