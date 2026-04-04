'use client';

import React, { useEffect, useState } from 'react';
import { MeshNode } from '../../types/mesh';
import { X } from 'lucide-react';

interface Props {
  node: MeshNode | null;
  onClose: () => void;
}

function getRelativeTime(date: Date): string {
  const diffInSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffInSeconds < 5) return 'Just now';
  if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
  return `${Math.floor(diffInSeconds / 60)}m ago`;
}

export default function NodeDetailPanel({ node, onClose }: Props) {
  const [relativeTime, setRelativeTime] = useState<string>('');

  useEffect(() => {
    if (!node) return;
    setRelativeTime(getRelativeTime(node.lastSeen));
    const interval = setInterval(() => {
      setRelativeTime(getRelativeTime(node.lastSeen));
    }, 1000);
    return () => clearInterval(interval);
  }, [node]); // Technically node.lastSeen is better, but since D3 mutates the object ref, we update continuously anyway.

  if (!node) return null;

  return (
    <div className="flex flex-col bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50 shrink-0">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="text-2xl bg-white w-10 h-10 rounded-full flex items-center justify-center shadow-sm border border-slate-200 shrink-0">
            {node.mascot}
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="font-mono font-bold text-slate-800 truncate" title={node.id}>
              {node.id.length > 12 ? node.id.slice(0, 12) + '…' : node.id}
            </span>
            <div className="mt-1">
              <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${
                node.role === 'gateway' ? 'bg-blue-100 text-blue-700 border border-blue-200' :
                node.role === 'relay' ? 'bg-teal-100 text-teal-700 border border-teal-200' :
                'bg-slate-100 text-slate-500 border border-slate-200'
              }`}>
                {node.role}
              </span>
            </div>
          </div>
        </div>
        <button 
          onClick={onClose} 
          className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors shrink-0"
        >
          <X size={18} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5">
        <div className="flex flex-col gap-4">
          
          <div className="flex justify-between items-center py-2 px-1 border-b border-slate-50">
            <span className="text-sm font-medium text-slate-500">Transport</span>
            <span className="text-sm font-bold text-slate-800 uppercase tracking-tight">{node.connType.replace('_', ' ')}</span>
          </div>
          
          <div className="flex justify-between items-center py-2 px-1 border-b border-slate-50">
            <span className="text-sm font-medium text-slate-500">Peers visible</span>
            <span className="text-sm font-bold text-slate-800">{node.peerIds.length}</span>
          </div>

          <div className="flex justify-between items-center py-2 px-1 border-b border-slate-50">
            <span className="text-sm font-medium text-slate-500">Hops relayed</span>
            <span className="text-sm font-bold text-slate-800">{node.hopCount} <span className="text-xs font-normal text-slate-400 ml-1">in last 60s</span></span>
          </div>

          <div className="flex justify-between items-center py-2 px-1 border-b border-slate-50">
            <span className="text-sm font-medium text-slate-500">Last seen</span>
            <span className="text-sm font-bold text-slate-800 font-mono" suppressHydrationWarning>{relativeTime}</span>
          </div>

          {node.isOrigin && (
            <div className="flex justify-between items-center py-2 px-1 border-b border-slate-50 bg-red-50 rounded-md -mx-2 px-3">
              <span className="text-sm font-medium text-red-700">Origin sender</span>
              <span className="text-sm font-bold text-red-800">Yes</span>
            </div>
          )}

          <div className="mt-2 flex flex-col gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 pl-1">Peer IDs</span>
            {node.peerIds.length > 0 ? (
              <div className="flex flex-col gap-1 max-h-[140px] overflow-y-auto w-full bg-slate-50 border border-slate-100 rounded-md p-2">
                {node.peerIds.map(pid => (
                  <div key={pid} className="font-mono text-xs text-slate-600 bg-white border border-slate-200 rounded px-2 py-1 shadow-sm truncate">
                    {pid.slice(0, 8)}…
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-sm text-slate-400 italic pl-1">No peers currently visible.</span>
            )}
          </div>

        </div>
      </div>

      {/* Footer */}
      <div className="p-3 bg-slate-50 border-t border-slate-100 shrink-0 text-center">
        <span className="text-[10px] text-slate-400 font-medium">Updates automatically via Supabase Realtime</span>
      </div>
    </div>
  );
}
