'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Navbar } from '../components/Navbar';
import { CreateProjectModal } from '../components/CreateProjectModal';
import { StatusBadge, SlotBadge } from '../components/StatusBadge';
import { Project, api } from '../lib/api';
import {
  ExternalLink,
  FolderGit2,
  GitBranch,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Layers,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);

  const fetchProjects = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getProjects();
      setProjects(res.projects);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch projects');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleQuickDeploy = async (projectId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      setTriggeringId(projectId);
      const res = await api.triggerDeploy(projectId);
      window.location.href = `/deployments/${res.deployment.id}`;
    } catch (err: any) {
      alert(`Deploy failed: ${err.message}`);
      setTriggeringId(null);
    }
  };

  const filteredProjects = projects.filter((p) => {
    const q = searchQuery.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q) || p.repoUrl.toLowerCase().includes(q);
  });

  const activeProjectsCount = projects.filter((p) => p.activeSlot !== null).length;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar onNewProject={() => setIsModalOpen(true)} />

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Top Header & Stats */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-3">
                <span>Projects & Services</span>
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                Self-hosted applications running with zero-downtime blue-green routing.
              </p>
            </div>

            <button
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 hover:from-blue-500 hover:to-indigo-500 transition-all active:scale-95"
            >
              <Plus className="h-4 w-4" />
              <span>Create Project</span>
            </button>
          </div>

          {/* Metric Stats Ribbon */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
            <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-4 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                <FolderGit2 className="h-4 w-4 text-blue-400" />
                <span>Total Services</span>
              </div>
              <p className="mt-2 text-2xl font-bold text-white">{projects.length}</p>
            </div>

            <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-4 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                <Server className="h-4 w-4 text-emerald-400" />
                <span>Live Deployments</span>
              </div>
              <p className="mt-2 text-2xl font-bold text-emerald-400">{activeProjectsCount}</p>
            </div>

            <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-4 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                <Layers className="h-4 w-4 text-indigo-400" />
                <span>Routing Engine</span>
              </div>
              <p className="mt-2 text-sm font-semibold text-slate-200">Traefik Blue-Green</p>
            </div>

            <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-4 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                <ShieldCheck className="h-4 w-4 text-cyan-400" />
                <span>Isolation Boundary</span>
              </div>
              <p className="mt-2 text-sm font-semibold text-cyan-300">CFS Quota Sandboxed</p>
            </div>
          </div>
        </div>

        {/* Search & Actions Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
          <div className="relative w-full sm:max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by project name, slug, or repository..."
              className="w-full rounded-xl border border-slate-800 bg-slate-900/80 pl-10 pr-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <button
            onClick={fetchProjects}
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            title="Refresh projects"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
            {error}
          </div>
        )}

        {/* Loading State */}
        {loading && projects.length === 0 ? (
          <div className="flex h-64 items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              <p className="text-xs text-slate-400">Loading services...</p>
            </div>
          </div>
        ) : filteredProjects.length === 0 ? (
          /* Empty State */
          <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-12 text-center">
            <FolderGit2 className="mx-auto h-12 w-12 text-slate-600 mb-4" />
            <h3 className="text-lg font-semibold text-white">No projects found</h3>
            <p className="mt-1 text-sm text-slate-400 max-w-sm mx-auto">
              {searchQuery ? 'No projects match your search.' : 'Get started by connecting your first GitHub repository.'}
            </p>
            {!searchQuery && (
              <button
                onClick={() => setIsModalOpen(true)}
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 transition-colors"
              >
                <Plus className="h-4 w-4" />
                <span>Create New Project</span>
              </button>
            )}
          </div>
        ) : (
          /* Projects Grid */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProjects.map((project) => {
              const latestDep = project.deployments?.[0];
              const liveDomain = `${project.slug}.shipyard.local`;

              return (
                <div
                  key={project.id}
                  className="group relative flex flex-col justify-between rounded-2xl border border-slate-800/80 bg-slate-900/60 p-6 glass-panel-hover"
                >
                  <div>
                    {/* Top Row: Name & Active Slot */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link
                          href={`/projects/${project.id}`}
                          className="text-lg font-bold text-white hover:text-blue-400 transition-colors line-clamp-1"
                        >
                          {project.name}
                        </Link>
                        <span className="font-mono text-xs text-slate-400 block mt-0.5">
                          {project.slug}
                        </span>
                      </div>
                      <SlotBadge slot={project.activeSlot} active={project.activeSlot !== null} />
                    </div>

                    {/* Live Domain Target */}
                    <div className="mt-4">
                      <a
                        href={`http://${liveDomain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group/link flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs transition-colors hover:border-slate-700 hover:bg-slate-950"
                        title={`Open live app at http://${liveDomain}`}
                      >
                        <span className="font-mono text-emerald-400 truncate max-w-[200px] sm:max-w-none">
                          {liveDomain}
                        </span>
                        <ExternalLink className="h-3.5 w-3.5 text-slate-500 group-hover/link:text-emerald-400 shrink-0" />
                      </a>
                    </div>

                    {/* Metadata & Git */}
                    <div className="mt-4 space-y-2 text-xs text-slate-400">
                      <div className="flex items-center gap-2 truncate">
                        <GitBranch className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                        <span className="text-slate-300 font-medium">{project.defaultBranch}</span>
                        <span className="text-slate-600">•</span>
                        <span className="truncate">{project.repoUrl}</span>
                      </div>

                      {latestDep && (
                        <div className="flex items-center gap-2 pt-2 border-t border-slate-800/60">
                          <span className="text-slate-500">Latest:</span>
                          <StatusBadge status={latestDep.status} size="sm" />
                          <span className="font-mono text-[11px] text-slate-500 truncate">
                            {latestDep.commitSha.slice(0, 7)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Bottom Action Footer */}
                  <div className="mt-6 flex items-center justify-between pt-4 border-t border-slate-800/80">
                    <button
                      onClick={(e) => handleQuickDeploy(project.id, e)}
                      disabled={triggeringId === project.id}
                      className="flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold text-blue-400 hover:bg-blue-500/20 active:scale-95 disabled:opacity-50 transition-all"
                    >
                      <Play className="h-3 w-3 fill-current" />
                      <span>{triggeringId === project.id ? 'Starting...' : 'Deploy'}</span>
                    </button>

                    <Link
                      href={`/projects/${project.id}`}
                      className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-white transition-colors"
                    >
                      <span>Manage</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <CreateProjectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onProjectCreated={() => fetchProjects()}
      />
    </div>
  );
}
