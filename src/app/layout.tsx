import type { Metadata, Viewport } from 'next';
import './globals.css';
import Navigation from '@/components/Navigation';
import SessionWrapper from '@/components/SessionWrapper';
import PwaRegister from '@/components/PwaRegister';

export const metadata: Metadata = {
  title: 'HydroLoop™ — Farm Manager',
  description: 'Système expert de gestion de ferme hydroponique verticale A-Frame NFT',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#166534',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <SessionWrapper>
          <Navigation />
          <main className="min-h-screen bg-gray-50">{children}</main>
          <PwaRegister />
        </SessionWrapper>
      </body>
    </html>
  );
}
