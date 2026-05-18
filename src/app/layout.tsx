import type { Metadata } from 'next';
import './globals.css';
import Navigation from '@/components/Navigation';

export const metadata: Metadata = {
  title: 'HydroLoop™ — Farm Management',
  description: 'Système expert de gestion de ferme hydroponique verticale A-Frame NFT',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <Navigation />
        <main className="min-h-screen bg-gray-50">{children}</main>
      </body>
    </html>
  );
}
