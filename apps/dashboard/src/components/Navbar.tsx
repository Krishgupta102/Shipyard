'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Anchor, ExternalLink, Plus, Terminal } from 'lucide-react';

interface NavbarProps {
  onNewProject?: () => void;
}

export function Navbar({ onNewProject }: NavbarProps) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <div className="flex items-center gap-8">
          <Link href="/" className="group flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 shadow-lg shadow-blue-500/25 transition-transform group-hover:scale-105">
              <Anchor className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold tracking-tight text-white">Shipyard</span>
                <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-400 border border-blue-500/20">
                  v0.1.0
                </span>
              </div>
              <p className="text-xs text-slate-400">Mini Cloud PaaS</p>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            <Link
              href="/"
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                pathname === '/'
                  ? 'bg-slate-800/80 text-white'
                  : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
              }`}
            >
              Projects
            </Link>
          </nav>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          {/* Edge Router Link */}
          <a
            href="http://localhost:8080"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:bg-slate-800/60 hover:text-white transition-all"
            title="Open Traefik Edge Router Dashboard"
          >
            <Terminal className="h-3.5 w-3.5 text-indigo-400" />
            <span>Traefik Proxy</span>
            <ExternalLink className="h-3 w-3 text-slate-500" />
          </a>

          {/* New Project Button */}
          {onNewProject && (
            <button
              onClick={onNewProject}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm shadow-blue-500/30 hover:bg-blue-500 active:scale-95 transition-all"
            >
              <Plus className="h-4 w-4" />
              <span>New Project</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
