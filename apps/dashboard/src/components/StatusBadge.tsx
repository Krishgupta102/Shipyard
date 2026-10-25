import React from 'react';
import { DeploymentStatus, DeploymentTrigger, Slot } from '@shipyard/shared';
import { CheckCircle2, XCircle, Clock, Loader2, Ban, RotateCcw, GitBranch, Terminal } from 'lucide-react';

interface StatusBadgeProps {
  status: DeploymentStatus | string;
  size?: 'sm' | 'md';
}

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const isSm = size === 'sm';
  const sizeClasses = isSm ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs font-medium';

  switch (status) {
    case DeploymentStatus.SUCCESS:
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 font-medium ${sizeClasses}`}>
          <CheckCircle2 className={isSm ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
          <span>Success</span>
        </span>
      );

    case DeploymentStatus.BUILDING:
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 text-amber-400 font-medium ${sizeClasses}`}>
          <Loader2 className={`${isSm ? 'h-3 w-3' : 'h-3.5 w-3.5'} animate-spin`} />
          <span>Building</span>
        </span>
      );

    case DeploymentStatus.DEPLOYING:
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full border border-cyan-500/20 bg-cyan-500/10 text-cyan-400 font-medium ${sizeClasses}`}>
          <Loader2 className={`${isSm ? 'h-3 w-3' : 'h-3.5 w-3.5'} animate-spin`} />
          <span>Deploying</span>
        </span>
      );

    case DeploymentStatus.QUEUED:
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/80 text-slate-300 font-medium ${sizeClasses}`}>
          <Clock className={isSm ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
          <span>Queued</span>
        </span>
      );

    case DeploymentStatus.FAILED:
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full border border-rose-500/20 bg-rose-500/10 text-rose-400 font-medium ${sizeClasses}`}>
          <XCircle className={isSm ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
          <span>Failed</span>
        </span>
      );

    case DeploymentStatus.CANCELLED:
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/50 text-slate-400 font-medium ${sizeClasses}`}>
          <Ban className={isSm ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
          <span>Cancelled</span>
        </span>
      );

    default:
      return (
        <span className={`inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900 text-slate-400 ${sizeClasses}`}>
          <span>{status}</span>
        </span>
      );
  }
}

export function SlotBadge({ slot, active = false }: { slot: Slot | null | string; active?: boolean }) {
  if (!slot) {
    return (
      <span className="inline-flex items-center rounded-md border border-slate-800 bg-slate-900/50 px-2 py-0.5 text-xs text-slate-400">
        Inactive
      </span>
    );
  }

  const isBlue = slot === Slot.BLUE;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold ${
        isBlue
          ? 'border border-blue-500/30 bg-blue-500/15 text-blue-400 shadow-sm shadow-blue-500/10'
          : 'border border-emerald-500/30 bg-emerald-500/15 text-emerald-400 shadow-sm shadow-emerald-500/10'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          isBlue ? 'bg-blue-400' : 'bg-emerald-400'
        } ${active ? 'animate-pulse' : ''}`}
      />
      <span>{slot}</span>
      {active && <span className="text-[10px] uppercase tracking-wider opacity-75">LIVE</span>}
    </span>
  );
}

export function TriggerBadge({ trigger }: { trigger: DeploymentTrigger | string }) {
  switch (trigger) {
    case DeploymentTrigger.GITHUB_WEBHOOK:
      return (
        <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-medium text-slate-300 border border-slate-700/60">
          <GitBranch className="h-3 w-3 text-purple-400" />
          <span>Git Push</span>
        </span>
      );

    case DeploymentTrigger.ROLLBACK:
      return (
        <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-300 border border-amber-500/20">
          <RotateCcw className="h-3 w-3 text-amber-400" />
          <span>Rollback</span>
        </span>
      );

    case DeploymentTrigger.MANUAL:
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-medium text-slate-300 border border-slate-700/60">
          <Terminal className="h-3 w-3 text-blue-400" />
          <span>Manual</span>
        </span>
      );
  }
}
