'use client';

import React, { useEffect, useState } from 'react';
import { MeshStats } from '../../types/mesh';

interface Props {
  stats: MeshStats;
  className?: string;
}

function getRelativeTime(date: Date | null): string {
  if (!date) return 'Waiting...';
  const diffInSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffInSeconds < 5) return 'Just now';
  if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
  const diffInMins = Math.floor(diffInSeconds / 60);
  return `${diffInMins}m ago`;
}

export default function MeshStatsBar({ stats, className = '' }: Props) {
  const [relativeTime, setRelativeTime] = useState<string>(getRelativeTime(stats.lastUpdated));

  useEffect(() => {
    // Update the "last updated" relative time every second
    const interval = setInterval(() => {
      setRelativeTime(getRelativeTime(stats.lastUpdated));
    }, 1000);
    return () => clearInterval(interval);
  }, [stats.lastUpdated]);

  return (
    <div className={`flex flex-wrap items-center justify-between gap-4 p-4 bg-white border border-slate-200 rounded-xl shadow-sm ${className}`}>
      
      <div className="flex gap-4 md:gap-8 overflow-x-auto pb-1 no-scrollbar flex-1 whitespace-nowrap">
        {/* Active Nodes */}
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Nodes</span>
          <span className="text-2xl font-bold text-slate-900 mt-1">{stats.activeNodes}</span>
        </div>

        {/* Connections */}
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Connections</span>
          <span className="text-2xl font-bold text-slate-900 mt-1">{stats.totalEdges}</span>
        </div>

        {/* Gateways */}
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Gateways</span>
          <span className="text-2xl font-bold text-blue-600 mt-1">{stats.gatewayCount}</span>
        </div>

        {/* Offline */}
        <div className="flex flex-col opacity-70">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Offline</span>
          <span className="text-2xl font-bold text-slate-400 mt-1">{stats.offlineCount}</span>
        </div>

        {/* Avg Hops */}
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Avg Hops</span>
          <span className="text-2xl font-bold text-slate-900 mt-1">{stats.avgHopCount}</span>
        </div>

        {/* Last Updated */}
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Last Updated</span>
          <span className="text-[15px] font-mono font-medium text-slate-600 mt-1 uppercase tracking-tight" suppressHydrationWarning>
            {relativeTime}
          </span>
        </div>
      </div>

      {/* Connection Mode */}
      <div className="flex flex-col items-end shrink-0 pl-4 border-l border-slate-100">
        <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 mb-1">Status</span>
        <div className="flex items-center gap-2">
          {stats.isLive ? (
            <>
              <div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)] animate-pulse" />
              <span className="text-sm font-semibold text-slate-700">Live</span>
            </>
          ) : (
            <>
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)] animate-pulse" />
              <span className="text-sm font-semibold text-slate-700">Connecting...</span>
            </>
          )}
        </div>
      </div>

    </div>
  );
}
