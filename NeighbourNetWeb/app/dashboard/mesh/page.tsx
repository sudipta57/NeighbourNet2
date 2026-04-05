'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useMeshTelemetry } from '../../../hooks/useMeshTelemetry';
import { MeshNode } from '../../../types/mesh';
import MeshStatsBar from '../../../components/mesh/MeshStatsBar';
import NodeDetailPanel from '../../../components/mesh/NodeDetailPanel';
import MeshVisualiser, { MeshVisualiserRef } from '../../../components/mesh/MeshVisualiser';
import { Download, Maximize, AlertTriangle, Activity } from 'lucide-react';

export default function MeshDashboardPage() {
  const { nodes, stats, isConnected, error, simulateSpiderWeb } = useMeshTelemetry();
  const [selectedNode, setSelectedNode] = useState<MeshNode | null>(null);
  const [showOffline, setShowOffline] = useState(true);
  const [filterMode, setFilterMode] = useState<'all' | 'active' | 'gateway'>('all');
  
  const containerRef = useRef<HTMLDivElement>(null);
  const visRef = useRef<MeshVisualiserRef>(null);

  // Default to mobile size, but will adjust via ResizeObserver
  const [dimensions, setDimensions] = useState({ width: 800, height: 320 });

  useEffect(() => {
    // Determine initial height
    if (window.innerWidth >= 768) setDimensions(d => ({ ...d, height: 520 }));
    
    // Setup ResizeObserver
    const container = containerRef.current;
    if (!container) return;
    
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        setDimensions({
          width,
          height: window.innerWidth >= 768 ? 520 : 320
        });
      }
    });

    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Filter nodes for canvas subset
  const visibleNodes = nodes.filter(n => {
    if (!showOffline && n.role === 'offline') return false;
    if (filterMode === 'gateway') return n.role === 'gateway';
    if (filterMode === 'active') return n.role !== 'offline';
    return true;
  });

  // Check empty state
  const isEmptyLive = nodes.length === 0 && isConnected && !error;

  return (
    <div className="flex flex-col h-full w-full p-6 bg-slate-50 overflow-y-auto">
      
      {/* Title */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Mesh Network</h1>
        <p className="text-sm text-slate-500 font-medium mt-1">Live peer topology from active gateway devices</p>
      </div>

      {/* Error State */}
      {error && (
        <div className="mb-4 flex items-center justify-between p-4 bg-red-50 border border-red-200 text-red-800 rounded-lg shadow-sm">
          <div className="flex items-center gap-3">
            <AlertTriangle size={20} className="text-red-500" />
            <span className="font-semibold text-sm">{error}</span>
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="text-xs font-bold px-3 py-1.5 bg-red-100 hover:bg-red-200 rounded transition-colors uppercase tracking-wider"
          >
            Retry
          </button>
        </div>
      )}

      {/* Stats Bar */}
      <MeshStatsBar stats={stats} className="mb-4" />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4 bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
        
        <div className="flex items-center gap-4">
          <div className="flex bg-slate-100 rounded-lg p-1 border border-slate-200">
            <button onClick={() => setFilterMode('all')} className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${filterMode === 'all' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>All</button>
            <button onClick={() => setFilterMode('active')} className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${filterMode === 'active' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>Active only</button>
            <button onClick={() => setFilterMode('gateway')} className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${filterMode === 'gateway' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>Gateways only</button>
          </div>
          
          <label className="flex items-center gap-2 cursor-pointer group">
            <input 
              type="checkbox" 
              checked={showOffline} 
              onChange={e => setShowOffline(e.target.checked)}
              className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer" 
            />
            <span className="text-sm font-medium text-slate-600 group-hover:text-slate-800 transition-colors">Show offline</span>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => simulateSpiderWeb()}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
          >
            🕸️ Simulate Web
          </button>
          <button 
            onClick={() => visRef.current?.resetSimulation()}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <Maximize size={16} /> Fit
          </button>
          <button 
            onClick={() => {
              const dataUrl = visRef.current?.exportPNG();
              if (!dataUrl) return;
              const a = document.createElement('a');
              a.href = dataUrl;
              a.download = `mesh-export-${Date.now()}.png`;
              a.click();
            }}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <Download size={16} /> Export PNG
          </button>
        </div>

      </div>

      {/* Main Content Area */}
      <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0">
        
        {/* Canvas container (70% on desktop) */}
        <div 
          ref={containerRef} 
          className="flex-1 w-full bg-white rounded-xl border border-slate-200 shadow-sm relative overflow-hidden flex"
        >
          {isEmptyLive && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 bg-slate-50/50 backdrop-blur-[2px]">
              <div className="bg-white p-6 rounded-2xl shadow-lg border border-slate-200 flex flex-col items-center max-w-sm text-center">
                <div className="w-12 h-12 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mb-4 relative shadow-sm border border-blue-100">
                  <Activity size={24} className="animate-pulse" />
                </div>
                <h3 className="font-bold text-slate-800 text-lg mb-2">No active devices</h3>
                <p className="text-sm text-slate-500 leading-relaxed font-medium">
                  No devices seen in the last 2 minutes.<br />
                  Make sure at least one phone is running NeighbourNet with internet access, or click &quot;🕸️ Simulate Web&quot; above.
                </p>
              </div>
            </div>
          )}

          <MeshVisualiser
            ref={visRef}
            nodes={visibleNodes}
            width={dimensions.width}
            height={dimensions.height}
            showOffline={showOffline}
            isLive={isConnected}
            onNodeClick={(node) => setSelectedNode(node)}
            className="flex-1 min-w-0 min-h-0"
          />

          <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-md px-4 py-2 rounded-lg border border-slate-200 shadow-sm z-10 flex flex-wrap gap-4 text-xs font-medium text-slate-600">
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-blue-600 shadow-sm"></div> Gateway</div>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-teal-600 shadow-sm"></div> Relay</div>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full border-2 border-slate-400 border-dashed"></div> Offline</div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full border-2 border-red-500 animate-pulse"></div> Origin</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 ml-2 pt-0.5">Hover node to inspect · Drag to reposition · Updates every 5s</div>
          </div>
        </div>

        {/* Details Panel (30% on desktop) */}
        <div className="w-full md:w-80 shrink-0">
          {selectedNode ? (
            <NodeDetailPanel 
              node={selectedNode} 
              onClose={() => setSelectedNode(null)} 
            />
          ) : (
            <div className="h-full bg-white border border-slate-200 border-dashed rounded-xl flex items-center justify-center p-6 text-center text-slate-400">
              <span className="text-sm font-medium">Select a node from the graph to view details</span>
            </div>
          )}
        </div>

      </div>

    </div>
  );
}
