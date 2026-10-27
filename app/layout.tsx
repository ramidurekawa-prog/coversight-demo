import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/plus-jakarta-sans/800.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './globals.css';

import { Shell } from '../components/shell';

export const metadata: Metadata = {
  title: 'Coversight Product Demo',
  description: 'Coversight on a sample three-room restaurant group: every figure computed, labelled with how strong the claim is, and clickable.',
  icons: { icon: '/brand-mark.png' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
