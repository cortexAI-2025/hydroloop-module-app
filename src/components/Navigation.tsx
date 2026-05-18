'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Navigation() {
  const pathname = usePathname();

  const links = [
    { href: '/', label: 'Tableau de bord' },
    { href: '/batch/new', label: '+ Nouveau Batch' },
  ];

  return (
    <nav className="sticky top-0 z-50 bg-brand-800 shadow-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <LeafIcon />
            <span className="text-white font-bold text-lg tracking-tight">
              HydroLoop<sup className="text-xs font-normal">™</sup>
            </span>
            <span className="hidden sm:inline text-brand-300 text-xs font-medium">
              A-Frame NFT Manager
            </span>
          </Link>

          <div className="flex items-center gap-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                  ${pathname === l.href
                    ? 'bg-brand-600 text-white'
                    : 'text-brand-100 hover:bg-brand-700 hover:text-white'
                  }`}
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}

function LeafIcon() {
  return (
    <svg className="w-7 h-7 text-brand-300" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 8C8 10 5.9 16.17 3.82 21.34L5.71 22l1-2.3A4.49 4.49 0 008 20C19 20 22 3 22 3c-1 2-8 1-13 4S2 22 2 22c0-8 4-18 15-14z" />
    </svg>
  );
}
