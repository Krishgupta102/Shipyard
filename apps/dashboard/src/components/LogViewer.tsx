'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { LogLine, api } from '../lib/api';
import { LogStream } from '@shipyard/shared';
import {
  ArrowDown,
  Check,
  Copy,
  Radio,
  Search,
  Terminal as TerminalIcon,
  Filter,
} from 'lucide-react';

interface LogViewerProps {
  deploymentId: string;
  initialStatus?: string;
  onStatusChange?: (newStatus: string) => void;
}

export function LogViewer({ deploymentId, initialStatus, onStatusChange }: LogViewerProps) {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'completed' | 'error'>('connecting');
  const [searchQuery, setSearchQuery] = useState('');
  const [streamFilter, setStreamFilter] = useState<'ALL' | 'SYSTEM' | 'STDOUT' | 'STDERR'>('ALL');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);

  // Connect to SSE stream
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let isCancelled = false;

    setLogs([]);
    setConnectionState('connecting');

    const streamUrl = api.getLogStreamUrl(deploymentId);
    eventSource = new EventSource(streamUrl);

    eventSource.onopen = () => {
      if (!isCancelled) {
        setConnectionState('connected');
      }
    };

    // State sync event
    eventSource.addEventListener('state', (e: Event) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        if (data.status && onStatusChange) {
          onStatusChange(data.status);
        }
      } catch {}
    });

    // Stream line message
    eventSource.onmessage = (event) => {
      if (isCancelled) return;
      try {
        const data = JSON.parse(event.data);
        if (data.message !== undefined) {
          setLogs((prev) => [...prev, data]);
        }
      } catch {
        // Plain string message fallback
        setLogs((prev) => [
          ...prev,
          {
            deploymentId,
            stream: LogStream.SYSTEM,
            message: event.data,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    };

    // Terminal completion event
    eventSource.addEventListener('end', () => {
      if (!isCancelled) {
        setConnectionState('completed');
        eventSource?.close();
      }
    });

    eventSource.onerror = () => {
      if (!isCancelled) {
        // If the deployment was already finished, error on EventSource close is normal
        if (initialStatus === 'SUCCESS' || initialStatus === 'FAILED' || initialStatus === 'CANCELLED') {
          setConnectionState('completed');
        } else {
          setConnectionState('error');
        }
        eventSource?.close();
      }
    };

    return () => {
      isCancelled = true;
      eventSource?.close();
    };
  }, [deploymentId, initialStatus, onStatusChange]);

  // Handle auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && bottomAnchorRef.current) {
      bottomAnchorRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [logs, autoScroll]);

  // Detect user manual scroll up to toggle auto-scroll off
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isAtBottom);
  };

  const scrollToBottom = () => {
    setAutoScroll(true);
    bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // Filter logs based on search query and stream filter
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (streamFilter !== 'ALL' && log.stream !== streamFilter) {
        return false;
      }
      if (searchQuery.trim() !== '') {
        return log.message.toLowerCase().includes(searchQuery.toLowerCase());
      }
      return true;
    });
  }, [logs, streamFilter, searchQuery]);

  const copyAllLogs = () => {
    const text = logs.map((l) => `[${l.timestamp}] [${l.stream}] ${l.message}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-950/90 shadow-2xl overflow-hidden terminal-window">
      {/* Terminal Title Bar */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-800/80 bg-slate-900/80 px-4 py-2.5 gap-3">
        {/* Left: Window Controls & Title */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded-full bg-rose-500/80 border border-rose-600/40" />
            <div className="h-3 w-3 rounded-full bg-amber-500/80 border border-amber-600/40" />
            <div className="h-3 w-3 rounded-full bg-emerald-500/80 border border-emerald-600/40" />
          </div>

          <div className="flex items-center gap-2 pl-2 border-l border-slate-800 text-xs text-slate-300 font-medium">
            <TerminalIcon className="h-3.5 w-3.5 text-blue-400" />
            <span>Deployment Logs</span>
            <span className="text-slate-500 font-mono text-[11px] truncate max-w-[120px] sm:max-w-none">
              {deploymentId}
            </span>
          </div>
        </div>

        {/* Right: Status Pill & Actions */}
        <div className="flex items-center gap-2">
          {/* Connection Status Indicator */}
          <div className="flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-950/60 px-2.5 py-1 text-xs">
            {connectionState === 'connected' ? (
              <>
                <Radio className="h-3 w-3 text-emerald-400 animate-pulse" />
                <span className="text-[11px] font-semibold text-emerald-400">LIVE</span>
              </>
            ) : connectionState === 'completed' ? (
              <>
                <div className="h-2 w-2 rounded-full bg-slate-500" />
                <span className="text-[11px] text-slate-400">Completed</span>
              </>
            ) : connectionState === 'error' ? (
              <>
                <div className="h-2 w-2 rounded-full bg-rose-500" />
                <span className="text-[11px] text-rose-400">Disconnected</span>
              </>
            ) : (
              <>
                <div className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
                <span className="text-[11px] text-amber-300">Connecting</span>
              </>
            )}
          </div>

          {/* Copy Button */}
          <button
            onClick={copyAllLogs}
            disabled={logs.length === 0}
            className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-700 hover:bg-slate-800 hover:text-white disabled:opacity-50 transition-colors"
            title="Copy all logs"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/* Terminal Toolbar: Filters & Search */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-800/60 bg-slate-900/40 px-4 py-2 gap-2 text-xs">
        {/* Stream Filter Tabs */}
        <div className="flex items-center gap-1">
          <Filter className="h-3 w-3 text-slate-500 mr-1" />
          {(['ALL', 'SYSTEM', 'STDOUT', 'STDERR'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setStreamFilter(filter)}
              className={`rounded px-2 py-0.5 font-medium transition-colors ${
                streamFilter === filter
                  ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>

        {/* Search Bar */}
        <div className="relative flex items-center min-w-[160px] sm:min-w-[220px]">
          <Search className="absolute left-2.5 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search logs..."
            className="w-full rounded-md border border-slate-800 bg-slate-950/80 pl-8 pr-3 py-1 text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
          />
        </div>
      </div>

      {/* Terminal Output Area */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="relative h-[480px] overflow-y-auto px-4 py-3 font-mono text-[12.5px] leading-relaxed selection:bg-blue-500/30"
      >
        {filteredLogs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-slate-500 text-xs">
            {logs.length === 0 ? (
              <>
                <Radio className="h-6 w-6 text-slate-600 animate-pulse mb-2" />
                <p>Waiting for deployment logs...</p>
              </>
            ) : (
              <p>No log lines match current search/filter criteria.</p>
            )}
          </div>
        ) : (
          filteredLogs.map((log, idx) => {
            const timeStr = new Date(log.timestamp).toLocaleTimeString([], {
              hour12: false,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });

            return (
              <div
                key={log.id || `${log.timestamp}-${idx}`}
                className="group flex items-start gap-3 py-0.5 hover:bg-slate-900/40 rounded px-1 -mx-1"
              >
                {/* Line Index */}
                <span className="select-none text-slate-600 text-[11px] w-7 text-right shrink-0">
                  {idx + 1}
                </span>

                {/* Timestamp */}
                <span className="select-none text-slate-500 text-[11px] shrink-0">
                  {timeStr}
                </span>

                {/* Stream Badge */}
                <span
                  className={`select-none text-[10px] font-semibold uppercase px-1 rounded shrink-0 ${
                    log.stream === LogStream.SYSTEM
                      ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                      : log.stream === LogStream.STDERR
                      ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                      : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                  }`}
                >
                  {log.stream}
                </span>

                {/* Log Content */}
                <span
                  className={`break-all whitespace-pre-wrap flex-1 ${
                    log.stream === LogStream.SYSTEM
                      ? 'text-cyan-200'
                      : log.stream === LogStream.STDERR
                      ? 'text-rose-300'
                      : 'text-slate-200'
                  }`}
                >
                  {log.message}
                </span>
              </div>
            );
          })
        )}
        <div ref={bottomAnchorRef} />
      </div>

      {/* Auto-scroll Jump Button (Visible when scrolled up) */}
      {!autoScroll && (
        <div className="absolute bottom-4 right-6 z-10">
          <button
            onClick={scrollToBottom}
            className="flex items-center gap-1.5 rounded-full border border-blue-500/40 bg-blue-600/90 px-3 py-1 text-xs font-medium text-white shadow-lg shadow-blue-500/25 hover:bg-blue-500 backdrop-blur-md transition-all active:scale-95"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            <span>Resume Auto-Scroll</span>
          </button>
        </div>
      )}
    </div>
  );
}
