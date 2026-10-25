import './globals.css';
import React from 'react';

export const metadata = {
  title: 'Shipyard — Self-Hosted Mini Cloud Platform',
  description: 'Self-hosted PaaS with zero-downtime blue-green deployments, live SSE logs, and automatic rollbacks.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-blue-600/30 selection:text-white">
        {children}
      </body>
    </html>
  );
}
