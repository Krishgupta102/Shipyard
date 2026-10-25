'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Navbar } from '../../../components/Navbar';
import { StatusBadge, SlotBadge, TriggerBadge } from '../../../components/StatusBadge';
import { Project, Deployment, ProjectEnvVar, api } from '../../../lib/api';
import {
  ArrowLeft,
  ExternalLink,
  GitBranch,
  Play,
  RotateCcw,
  Terminal,
  Trash2,
  Plus,
  Eye,
  EyeOff,
  Settings,
  Layers,
  KeyRound,
  Clock,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [envVars, setEnvVars] = useState<ProjectEnvVar[]>([]);
  const [activeTab, setActiveTab] = useState<'deployments' | 'env' | 'settings'>('deployments');
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New Env Var State
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newIsSecret, setNewIsSecret] = useState(false);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [projRes, depRes, envRes] = await Promise.all([
        api.getProject(projectId),
        api.getDeployments(projectId),
        api.getEnvVars(projectId),
      ]);

      setProject(projRes.project);
      setDeployments(depRes.deployments);
      setEnvVars(envRes.envVars);
    } catch (err: any) {
      setError(err.message || 'Failed to load project details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [projectId]);

  const handleTriggerDeploy = async () => {
    try {
      setDeploying(true);
      const res = await api.triggerDeploy(projectId);
      router.push(`/deployments/${res.deployment.id}`);
    } catch (err: any) {
      alert(`Deployment failed to start: ${err.message}`);
      setDeploying(false);
    }
  };

  const handleRollback = async (targetDeploymentId: string) => {
    if (!confirm('Are you sure you want to trigger a zero-downtime rollback to this verified version?')) {
      return;
    }

    try {
      const res = await api.rollback(projectId, targetDeploymentId);
      router.push(`/deployments/${res.deployment.id}`);
    } catch (err: any) {
      alert(`Rollback failed: ${err.message}`);
    }
  };

  const handleAddEnvVar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim()) return;

    try {
      await api.setEnvVar(projectId, {
        key: newKey.trim(),
        value: newValue,
        isSecret: newIsSecret,
      });
      setNewKey('');
      setNewValue('');
      setNewIsSecret(false);
      const updated = await api.getEnvVars(projectId);
      setEnvVars(updated.envVars);
    } catch (err: any) {
      alert(`Failed to save env var: ${err.message}`);
    }
  };

  const handleDeleteEnvVar = async (key: string) => {
    if (!confirm(`Delete environment variable "${key}"?`)) return;

    try {
      await api.deleteEnvVar(projectId, key);
      setEnvVars(envVars.filter((v) => v.key !== key));
    } catch (err: any) {
      alert(`Failed to delete env var: ${err.message}`);
    }
  };

  const handleDeleteProject = async () => {
    if (!confirm(`Are you sure you want to permanently delete "${project?.name}" and all deployments?`)) {
      return;
    }

    try {
      await api.deleteProject(projectId);
      router.push('/');
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const toggleReveal = (key: string) => {
    setRevealedSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (loading && !project) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 max-w-7xl mx-auto px-4 py-16 text-center">
          <h2 className="text-xl font-bold text-white">Project not found</h2>
          <Link href="/" className="mt-4 inline-block text-sm text-blue-400 hover:underline">
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  const liveDomain = `${project.slug}.shipyard.local`;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Breadcrumb Back */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors mb-6"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Projects</span>
        </Link>

        {/* Project Header Card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 sm:p-8 backdrop-blur-md mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl sm:text-3xl font-bold text-white">{project.name}</h1>
                <SlotBadge slot={project.activeSlot} active={project.activeSlot !== null} />
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-400">
                <span className="font-mono text-slate-300">{project.slug}</span>
                <span className="text-slate-600">•</span>
                <div className="flex items-center gap-1.5">
                  <GitBranch className="h-3.5 w-3.5 text-purple-400" />
                  <span>{project.defaultBranch}</span>
                </div>
                <span className="text-slate-600">•</span>
                <span className="truncate max-w-xs">{project.repoUrl}</span>
              </div>

              {/* Ingress Link */}
              <div className="mt-4 inline-block">
                <a
                  href={`http://${liveDomain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-mono font-medium text-emerald-400 hover:bg-emerald-500/20 transition-all"
                >
                  <span>http://{liveDomain}</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>

            {/* Deploy Trigger Button */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleTriggerDeploy}
                disabled={deploying}
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 hover:bg-blue-500 active:scale-95 disabled:opacity-50 transition-all"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>{deploying ? 'Enqueuing...' : 'Deploy Now'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-slate-800 mb-6">
          <div className="flex items-center gap-8">
            <button
              onClick={() => setActiveTab('deployments')}
              className={`flex items-center gap-2 pb-3 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === 'deployments'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="h-4 w-4" />
              <span>Deployments ({deployments.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('env')}
              className={`flex items-center gap-2 pb-3 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === 'env'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <KeyRound className="h-4 w-4" />
              <span>Environment Variables ({envVars.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center gap-2 pb-3 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === 'settings'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Settings className="h-4 w-4" />
              <span>Settings</span>
            </button>
          </div>
        </div>

        {/* TAB 1: Deployments History */}
        {activeTab === 'deployments' && (
          <div className="space-y-4">
            {deployments.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-slate-400">
                <Clock className="mx-auto h-8 w-8 text-slate-600 mb-2" />
                <p>No deployments yet. Click "Deploy Now" to launch your first build.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 shadow-lg">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-800 bg-slate-950/70 text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Slot</th>
                      <th className="px-4 py-3 font-medium">Commit SHA</th>
                      <th className="px-4 py-3 font-medium">Trigger</th>
                      <th className="px-4 py-3 font-medium">Created</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-200">
                    {deployments.map((dep) => {
                      const isCurrentLive = project.activeDeploymentId === dep.id;
                      const canRollback = dep.status === 'SUCCESS' && !isCurrentLive && dep.imageTag;

                      return (
                        <tr key={dep.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2">
                              <StatusBadge status={dep.status} size="sm" />
                              {isCurrentLive && (
                                <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
                                  ACTIVE
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3.5 font-mono text-slate-400">
                            {dep.targetSlot}
                          </td>
                          <td className="px-4 py-3.5 font-mono">
                            <span className="text-slate-300 font-semibold">{dep.commitSha.slice(0, 7)}</span>
                            {dep.commitMessage && (
                              <span className="block text-slate-500 text-[11px] truncate max-w-xs">
                                {dep.commitMessage}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3.5">
                            <TriggerBadge trigger={dep.trigger} />
                          </td>
                          <td className="px-4 py-3.5 text-slate-400">
                            {new Date(dep.createdAt).toLocaleString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {/* Rollback button */}
                              {canRollback && (
                                <button
                                  onClick={() => handleRollback(dep.id)}
                                  className="flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/20 transition-colors"
                                  title="Rollback to this immutable version without rebuild"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  <span>Rollback</span>
                                </button>
                              )}

                              {/* View live logs */}
                              <Link
                                href={`/deployments/${dep.id}`}
                                className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:border-slate-600 hover:text-white transition-colors"
                              >
                                <Terminal className="h-3 w-3 text-blue-400" />
                                <span>Logs</span>
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Environment Variables */}
        {activeTab === 'env' && (
          <div className="space-y-6">
            {/* Add New Env Var Form */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <h3 className="text-sm font-semibold text-white mb-3">Add Environment Variable</h3>
              <form onSubmit={handleAddEnvVar} className="flex flex-wrap items-center gap-3">
                <input
                  type="text"
                  required
                  placeholder="KEY (e.g. JWT_SECRET)"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 font-mono focus:border-blue-500 focus:outline-none"
                />
                <input
                  type="text"
                  required
                  placeholder="VALUE"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  className="flex-1 min-w-[200px] rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 font-mono focus:border-blue-500 focus:outline-none"
                />
                <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newIsSecret}
                    onChange={(e) => setNewIsSecret(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-blue-600"
                  />
                  <span>Mask Secret</span>
                </label>
                <button
                  type="submit"
                  className="flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Save Variable</span>
                </button>
              </form>
            </div>

            {/* Existing Env Vars Table */}
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 bg-slate-950/70 text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Key</th>
                    <th className="px-4 py-3 font-medium">Value</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium text-right">Delete</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-200">
                  {envVars.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-slate-500 italic">
                        No environment variables defined.
                      </td>
                    </tr>
                  ) : (
                    envVars.map((v) => {
                      const isRevealed = revealedSecrets[v.key];

                      return (
                        <tr key={v.id} className="hover:bg-slate-800/30">
                          <td className="px-4 py-3 font-mono font-semibold text-blue-400">{v.key}</td>
                          <td className="px-4 py-3 font-mono text-slate-300">
                            {v.isSecret && !isRevealed ? '••••••••••••••••' : v.value}
                          </td>
                          <td className="px-4 py-3">
                            {v.isSecret ? (
                              <button
                                onClick={() => toggleReveal(v.key)}
                                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white"
                              >
                                {isRevealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                                <span>{isRevealed ? 'Hide' : 'Reveal'}</span>
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-500">Plaintext</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => handleDeleteEnvVar(v.key)}
                              className="rounded p-1 text-slate-500 hover:text-rose-400"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: Settings & Danger Zone */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
              <h3 className="text-sm font-semibold text-white">Service Specifications</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-slate-400 block mb-1">Git Repository</span>
                  <span className="font-mono text-slate-200">{project.repoUrl}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-1">Default Branch</span>
                  <span className="font-mono text-slate-200">{project.defaultBranch}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-1">Internal Container Port</span>
                  <span className="font-mono text-slate-200">{project.port}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-1">Health Check Path</span>
                  <span className="font-mono text-slate-200">{project.healthCheckPath}</span>
                </div>
              </div>

              {/* Webhook Configuration helper */}
              <div className="pt-4 border-t border-slate-800">
                <span className="text-xs font-semibold text-slate-300 block mb-1">GitHub Webhook URL</span>
                <p className="text-[11px] text-slate-400 mb-2">
                  Configure this endpoint in your GitHub repository settings to automatically trigger builds on push:
                </p>
                <div className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-mono text-indigo-300 border border-slate-800">
                  http://localhost:3001/api/webhooks/github
                </div>
              </div>
            </div>

            {/* Danger Zone */}
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-6">
              <h3 className="text-sm font-semibold text-rose-400 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                <span>Danger Zone</span>
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Deleting this service will remove all historical deployment logs, configuration, and stop running containers.
              </p>
              <button
                onClick={handleDeleteProject}
                className="mt-4 rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 transition-colors shadow-sm shadow-rose-600/30"
              >
                Delete This Project
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
