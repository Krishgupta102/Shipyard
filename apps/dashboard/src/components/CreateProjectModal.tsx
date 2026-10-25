'use client';

import React, { useState } from 'react';
import { api } from '../lib/api';
import { X, Plus, Trash2, Globe, GitBranch, FolderGit2 } from 'lucide-react';

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: (projectSlug: string) => void;
}

export function CreateProjectModal({ isOpen, onClose, onProjectCreated }: CreateProjectModalProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [port, setPort] = useState(3000);
  const [healthCheckPath, setHealthCheckPath] = useState('/health');
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string; isSecret: boolean }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleNameChange = (val: string) => {
    setName(val);
    // Auto-generate slug from name if not manually modified
    const generated = val
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    setSlug(generated);
  };

  const addEnvVarRow = () => {
    setEnvVars([...envVars, { key: '', value: '', isSecret: false }]);
  };

  const removeEnvVarRow = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index));
  };

  const updateEnvVarRow = (index: number, field: 'key' | 'value' | 'isSecret', val: any) => {
    const updated = [...envVars];
    updated[index] = { ...updated[index], [field]: val } as { key: string; value: string; isSecret: boolean };
    setEnvVars(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const validEnvVars = envVars.filter((v) => v.key.trim() !== '');
      const res = await api.createProject({
        name,
        slug: slug.trim() ? slug : undefined,
        repoUrl,
        defaultBranch,
        port: Number(port),
        healthCheckPath,
        envVars: validEnvVars,
      });

      onProjectCreated(res.project.slug);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create project');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl p-6 sm:p-8 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <FolderGit2 className="h-5 w-5 text-blue-500" />
              <span>Register New Project</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Connect a GitHub repository with a Dockerfile for automated zero-downtime deployments.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Project Name *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. Orders API"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Slug */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Domain Subdomain Slug *</label>
              <input
                type="text"
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="orders-api"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* URL Preview */}
          {slug && (
            <div className="flex items-center gap-2 rounded-lg bg-slate-950/80 border border-slate-800/80 px-3 py-2 text-xs text-slate-400">
              <Globe className="h-4 w-4 text-emerald-400 shrink-0" />
              <span>Live Ingress Target:</span>
              <span className="font-mono text-emerald-400 font-semibold">{slug}.shipyard.local</span>
            </div>
          )}

          {/* Repo URL */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Git Repository URL *</label>
            <input
              type="text"
              required
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo.git or local path"
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Default Branch */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1">
                <GitBranch className="h-3.5 w-3.5 text-purple-400" />
                <span>Default Branch</span>
              </label>
              <input
                type="text"
                value={defaultBranch}
                onChange={(e) => setDefaultBranch(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Container Port */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Container Port</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(parseInt(e.target.value, 10) || 3000)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Health Check Path */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Health Check Path</label>
              <input
                type="text"
                value={healthCheckPath}
                onChange={(e) => setHealthCheckPath(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Environment Variables Section */}
          <div className="pt-2 border-t border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-200">Environment Variables</span>
              <button
                type="button"
                onClick={addEnvVarRow}
                className="flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Variable</span>
              </button>
            </div>

            {envVars.length === 0 ? (
              <p className="text-xs text-slate-500 italic">No environment variables added yet.</p>
            ) : (
              <div className="space-y-2">
                {envVars.map((env, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="KEY (e.g. DB_HOST)"
                      value={env.key}
                      onChange={(e) => updateEnvVarRow(i, 'key', e.target.value)}
                      className="w-1/3 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 font-mono"
                    />
                    <input
                      type="text"
                      placeholder="VALUE"
                      value={env.value}
                      onChange={(e) => updateEnvVarRow(i, 'value', e.target.value)}
                      className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 font-mono"
                    />
                    <label className="flex items-center gap-1 text-[11px] text-slate-400 shrink-0">
                      <input
                        type="checkbox"
                        checked={env.isSecret}
                        onChange={(e) => updateEnvVarRow(i, 'isSecret', e.target.checked)}
                        className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-0"
                      />
                      <span>Secret</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => removeEnvVarRow(i)}
                      className="rounded p-1 text-slate-500 hover:text-rose-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Submit Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-blue-600 px-5 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 shadow-md shadow-blue-500/20"
            >
              {loading ? 'Creating...' : 'Create & Register'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
