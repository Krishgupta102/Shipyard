'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Navbar } from '../../../components/Navbar';
import { StatusBadge, SlotBadge, TriggerBadge } from '../../../components/StatusBadge';
import { DeploymentStepper } from '../../../components/DeploymentStepper';
import { LogViewer } from '../../../components/LogViewer';
import { Deployment, api } from '../../../lib/api';
import { DeploymentStatus } from '@shipyard/shared';
import {
  ArrowLeft,
  ExternalLink,
  GitBranch,
  Ban,
  Clock,
  Layers,
  CheckCircle2,
} from 'lucide-react';

export default function DeploymentDetailPage() {
  const params = useParams();
  const deploymentId = params.id as string;

  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDeployment = async () => {
    try {
      const res = await api.getDeployment(deploymentId);
      setDeployment(res.deployment);
    } catch (err: any) {
      setError(err.message || 'Failed to load deployment');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeployment();
  }, [deploymentId]);

  // Handle real-time status update from LogViewer SSE state event
  const handleStatusChange = (newStatus: string) => {
    setDeployment((prev) => (prev ? { ...prev, status: newStatus as DeploymentStatus } : prev));
  };

  const handleCancel = async () => {
    if (!confirm('Are you sure you want to cancel this deployment?')) return;

    try {
      setCancelling(true);
      await api.cancelDeployment(deploymentId);
      await fetchDeployment();
    } catch (err: any) {
      alert(`Cancel failed: ${err.message}`);
    } finally {
      setCancelling(false);
    }
  };

  if (loading && !deployment) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        </div>
      </div>
    );
  }

  if (!deployment) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 max-w-7xl mx-auto px-4 py-16 text-center">
          <h2 className="text-xl font-bold text-white">Deployment not found</h2>
          <Link href="/" className="mt-4 inline-block text-sm text-blue-400 hover:underline">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  const projectSlug = deployment.project?.slug || 'app';
  const liveUrl = `http://${projectSlug}.shipyard.local`;
  const canCancel =
    deployment.status === DeploymentStatus.QUEUED || deployment.status === DeploymentStatus.BUILDING;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Back link */}
        <Link
          href={`/projects/${deployment.projectId}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors mb-6"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to {deployment.project?.name || 'Project'}</span>
        </Link>

        {/* Deployment Header Card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 sm:p-8 backdrop-blur-md mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
                  <span>Deployment</span>
                  <span className="font-mono text-slate-400 text-lg">#{deployment.id.slice(0, 8)}</span>
                </h1>
                <StatusBadge status={deployment.status} />
                <SlotBadge slot={deployment.targetSlot} active={deployment.status === DeploymentStatus.SUCCESS} />
              </div>

              {/* Commit and trigger details */}
              <div className="mt-2.5 flex flex-wrap items-center gap-4 text-xs text-slate-400">
                <TriggerBadge trigger={deployment.trigger} />
                <span className="text-slate-600">•</span>
                <div className="flex items-center gap-1.5 font-mono text-slate-300">
                  <GitBranch className="h-3.5 w-3.5 text-purple-400" />
                  <span>{deployment.commitSha.slice(0, 7)}</span>
                </div>
                {deployment.commitMessage && (
                  <>
                    <span className="text-slate-600">•</span>
                    <span className="text-slate-300 truncate max-w-sm">{deployment.commitMessage}</span>
                  </>
                )}
                <span className="text-slate-600">•</span>
                <span className="text-slate-500">
                  {new Date(deployment.createdAt).toLocaleString()}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              {/* Cancel Button */}
              {canCancel && (
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 active:scale-95 disabled:opacity-50 transition-all"
                >
                  <Ban className="h-3.5 w-3.5" />
                  <span>{cancelling ? 'Cancelling...' : 'Cancel Deployment'}</span>
                </button>
              )}

              {/* Live App Link if Success */}
              {deployment.status === DeploymentStatus.SUCCESS && (
                <a
                  href={liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-500 active:scale-95 transition-all"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>View Live App</span>
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Visual Stepper */}
        <div className="mb-6">
          <DeploymentStepper status={deployment.status} errorMessage={deployment.errorMessage} />
        </div>

        {/* Live SSE Terminal Log Viewer */}
        <div>
          <LogViewer
            deploymentId={deployment.id}
            initialStatus={deployment.status}
            onStatusChange={handleStatusChange}
          />
        </div>
      </main>
    </div>
  );
}
