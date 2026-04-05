'use client';

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import { supabase } from '../../lib/supabaseClient';
import { MeshTelemetry } from '../../lib/types';
import { Download, Maximize, Filter, Network, Activity, Router, Share2 } from 'lucide-react';

interface MeshNetworkVisualiserProps {
  squadId?: string;
  height?: number;
  onNodeSelect?: (deviceId: string) => void;
  showOffline?: boolean;
  mockMode?: boolean;
}

interface GraphNode extends d3.SimulationNodeDatum, MeshTelemetry {}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

export default function MeshNetworkVisualiser({
  squadId,
  height = 480,
  onNodeSelect,
  showOffline = true,
  mockMode = false
}: MeshNetworkVisualiserProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // D3 Refs to persist object identity across renders
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const linksRef = useRef<GraphLink[]>([]);
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const frameRef = useRef<number>(0);
  const hoveredNodeRef = useRef<string | null>(null);

  // States
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [filterMode, setFilterMode] = useState<'all' | 'gateway' | 'active'>('all');
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  
  // Realtime subscription ref
  const channelRef = useRef<any>(null);

  // Stats derived from ref mapping, updated periodically for UI
  const [stats, setStats] = useState({ active: 0, edges: 0, gateways: 0, avgHop: 0 });

  const updateStats = useCallback(() => {
    const nodes = nodesRef.current;
    const links = linksRef.current;
    const active = nodes.filter(n => n.role !== 'offline').length;
    const gateways = nodes.filter(n => n.role === 'gateway').length;
    const activeHops = nodes.filter(n => n.role !== 'offline' && n.hop_count !== undefined).map(n => n.hop_count);
    const avgHop = activeHops.length ? (activeHops.reduce((a,b) => a+b, 0) / activeHops.length) : 0;
    setStats({ active, edges: links.length, gateways, avgHop: Number(avgHop.toFixed(1)) });
    setLastUpdate(new Date());
  }, []);

  // Initialize D3 Simulation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Scale canvas for retina displays (DPI)
    const padding = 20;
    const cw = canvas.parentElement?.clientWidth || window.innerWidth;
    const ch = height;
    const dpi = window.devicePixelRatio || 1;
    
    canvas.width = cw * dpi;
    canvas.height = ch * dpi;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(dpi, dpi);

    const simulation = d3.forceSimulation<GraphNode>()
      .force('charge', d3.forceManyBody().strength(-300))
      .force('link', d3.forceLink<GraphNode, GraphLink>().id(d => d.device_id).distance(120))
      .force('center', d3.forceCenter(cw / 2, ch / 2))
      .force('collide', d3.forceCollide().radius(28));
      
    simulationRef.current = simulation;

    // Drawing Loop
    function render() {
      if (!context) return;
      const transform = transformRef.current;
      context.save();
      context.clearRect(0, 0, cw, ch);
      
      context.translate(transform.x, transform.y);
      context.scale(transform.k, transform.k);

      const now = Date.now();
      const nodes = nodesRef.current;
      const links = linksRef.current;

      // Filter logic applied loosely inside drawing to preserve physics structure
      const isVisible = (n: GraphNode) => {
        if (!showOffline && n.role === 'offline') return false;
        if (filterMode === 'gateway' && n.role !== 'gateway') return false;
        if (filterMode === 'active' && n.role === 'offline') return false;
        return true;
      };

      // Draw Links
      links.forEach(d => {
        const s = d.source as GraphNode;
        const t = d.target as GraphNode;
        if (!s.x || !s.y || !t.x || !t.y) return;
        if (!isVisible(s) || !isVisible(t)) return;

        const isGatewayEdge = s.role === 'gateway' || t.role === 'gateway';
        const isHoveredEdge = hoveredNodeRef.current && (hoveredNodeRef.current === s.device_id || hoveredNodeRef.current === t.device_id);
        
        context.beginPath();
        context.moveTo(s.x, s.y);
        context.lineTo(t.x, t.y);
        
        context.strokeStyle = isGatewayEdge ? '#60a5fa' : '#34d399'; // neon blue / emerald
        context.lineWidth = (isGatewayEdge ? 2 : 1) * (isHoveredEdge ? 2.5 : 1);
        context.globalAlpha = isHoveredEdge ? 0.8 : 0.4;
        
        if (!isGatewayEdge) {
          context.setLineDash([4, 4]);
        } else {
          context.setLineDash([]);
          // Add glow to gateway edges
          context.shadowColor = '#3b82f6';
          context.shadowBlur = 8;
        }
        
        context.stroke();
        context.shadowBlur = 0; // reset shadow
        
        // Packet animation on gateway links
        if (isGatewayEdge) {
          const timePhase = (now % 2000) / 2000;
          const dx = t.x - s.x;
          const dy = t.y - s.y;
          context.beginPath();
          context.arc(s.x + dx * timePhase, s.y + dy * timePhase, 3.5, 0, 2 * Math.PI);
          context.fillStyle = '#bfdbfe';
          context.shadowColor = '#bfdbfe';
          context.shadowBlur = 10;
          context.globalAlpha = 1.0;
          context.fill();
          context.shadowBlur = 0;
        }
      });
      context.setLineDash([]);
      context.globalAlpha = 1.0;

      // Draw Nodes
      nodes.forEach(n => {
        if (!n.x || !n.y || !isVisible(n)) return;
        if (n.role === 'offline' && now - new Date(n.last_seen).getTime() > 120000) return; // fade out dead nodes
        
        // Origin ring
        if (n.is_origin) {
          const pulseR = 18 + Math.sin(now / 200) * 4;
          context.beginPath();
          context.arc(n.x, n.y, pulseR, 0, 2 * Math.PI);
          context.strokeStyle = '#ef4444'; // Neon red
          context.lineWidth = 2;
          context.globalAlpha = 0.7;
          context.shadowColor = '#ef4444';
          context.shadowBlur = 15;
          context.stroke();
          context.globalAlpha = 1.0;
          context.shadowBlur = 0;
        }

        // Gateway pulse
        if (n.role === 'gateway') {
          const pulseR = 16 + Math.sin(now / 300) * 6;
          context.beginPath();
          context.arc(n.x, n.y, pulseR, 0, 2 * Math.PI);
          context.strokeStyle = 'rgba(96, 165, 250, 0.4)'; // neon blue
          context.lineWidth = 3;
          context.stroke();
        }

        const radius = n.role === 'gateway' ? 16 : n.role === 'relay' ? 14 : 12;

        context.beginPath();
        context.arc(n.x, n.y, radius, 0, 2 * Math.PI);
        
        if (n.role === 'offline') {
          context.strokeStyle = '#475569'; // slate-600
          context.lineWidth = 2;
          context.setLineDash([3, 3]);
          context.stroke();
          context.setLineDash([]);
          context.fillStyle = '#0f172a'; // slate-950
          context.fill();
        } else {
          context.fillStyle = n.role === 'gateway' ? '#1e3a8a' : '#064e3b'; // dark blue / dark emerald back
          context.shadowColor = n.role === 'gateway' ? '#3b82f6' : '#10b981';
          context.shadowBlur = 12;
          context.fill();
          context.strokeStyle = n.role === 'gateway' ? '#60a5fa' : '#34d399';
          context.lineWidth = 2;
          context.stroke();
          context.shadowBlur = 0;
        }

        // Mascot
        if (n.mascot) {
          context.font = `${radius - 2}px sans-serif`;
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          context.fillText(n.mascot, n.x, n.y + 1);
        }

        // GW Label
        if (n.role === 'gateway') {
          context.font = '10px sans-serif';
          context.fillStyle = '#93c5fd'; // blue-300
          context.fillText('GW', n.x, n.y + radius + 12);
        }
      });

      context.restore();
      frameRef.current = requestAnimationFrame(render);
    }
    
    frameRef.current = requestAnimationFrame(render);

    // Canvas Interactions
    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (e) => {
        transformRef.current = e.transform;
      });
    
    d3.select(canvas).call(zoom);

    // Custom drag
    d3.select(canvas)
      .on('mousemove', (e) => {
        const [mx, my] = d3.pointer(e);
        const t = transformRef.current;
        const x = (mx - t.x) / t.k;
        const y = (my - t.y) / t.k;
        const hit = simulationRef.current?.find(x, y, 20);
        
        if (hit) {
          setHoveredNode(hit);
          setTooltipPos({ x: mx, y: my });
          canvas.style.cursor = 'pointer';
          hoveredNodeRef.current = hit.device_id;
        } else {
          setHoveredNode(null);
          canvas.style.cursor = 'grab';
          hoveredNodeRef.current = null;
        }
      })
      .on('click', (e) => {
        if (!hoveredNodeRef.current) return;
        const hit = nodesRef.current.find(n => n.device_id === hoveredNodeRef.current);
        if (hit && onNodeSelect && hit.role !== 'offline') {
          onNodeSelect(hit.device_id);
        }
      })
      .call(d3.drag<HTMLCanvasElement, unknown>()
        .subject((e) => {
          const t = transformRef.current;
          const [mx, my] = d3.pointer(e);
          return simulationRef.current?.find((mx - t.x) / t.k, (my - t.y) / t.k, 20);
        })
        .on('start', (e) => {
          if (!e.active) simulationRef.current?.alphaTarget(0.3).restart();
          e.subject.fx = e.subject.x;
          e.subject.fy = e.subject.y;
        })
        .on('drag', (e) => {
          e.subject.fx = e.x;
          e.subject.fy = e.y;
        })
        .on('end', (e) => {
          if (!e.active) simulationRef.current?.alphaTarget(0);
          e.subject.fx = null;
          e.subject.fy = null;
        })
      );

    return () => {
      cancelAnimationFrame(frameRef.current);
      simulation.stop();
      d3.select(canvas).on('.drag', null).on('.zoom', null).on('mousemove', null).on('click', null);
    };
  }, [height, filterMode, showOffline, onNodeSelect]);

  // Data Fetching & Sync
  useEffect(() => {
    let interval: NodeJS.Timeout;

    const processNewData = (incomingNodes: MeshTelemetry[]) => {
      const sim = simulationRef.current;
      if (!sim) return;

      // Offline culling
      const now = Date.now();
      incomingNodes.forEach(n => {
        if (now - new Date(n.last_seen).getTime() > 60000 && n.role !== 'offline') {
          n.role = 'offline';
        }
      });

      // Merge nodes
      incomingNodes.forEach(inc => {
        const existing = nodesRef.current.find(n => n.device_id === inc.device_id);
        if (existing) {
          Object.assign(existing, inc); // preserves x, y, vx, vy
        } else {
          nodesRef.current.push({ ...inc } as GraphNode);
        }
      });
      // Purge dead nodes > 120s
      nodesRef.current = nodesRef.current.filter(n => (now - new Date(n.last_seen).getTime() <= 120000));

      // Rebuild edges
      const links: GraphLink[] = [];
      const nodeMap = new Map(nodesRef.current.map(n => [n.device_id, n]));
      
      nodesRef.current.forEach(source => {
        source.peer_ids?.forEach(peerId => {
          if (nodeMap.has(peerId)) {
            // Check for deduplication
            const existing = links.find(l => 
              (l.source === source.device_id && l.target === peerId) || 
              (l.source === peerId && l.target === source.device_id)
            );
            if (!existing) {
              links.push({ source: source.device_id, target: peerId });
            }
          }
        });
      });
      linksRef.current = links;

      sim.nodes(nodesRef.current);
      const linkForce = sim.force<d3.ForceLink<GraphNode, GraphLink>>('link');
      if (linkForce) linkForce.links(links);
      
      sim.alpha(0.3).restart();
      updateStats();
    };

    if (mockMode || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
      // Generate mock data
      const mascts = ['🦊','🐼','🦁','🐸','🐙','🦉','🦄','🐝','🐮','🐯','🦋','🐢'];
      const mnodes: MeshTelemetry[] = mascts.map((m, i) => ({
        device_id: `mock-${i}`,
        mascot: m,
        role: i === 0 ? 'gateway' : (Math.random() > 0.8 ? 'offline' : 'relay'),
        peer_ids: [],
        hop_count: Math.floor(Math.random() * 3),
        last_seen: new Date().toISOString(),
        conn_type: 'wifi_direct',
        is_origin: i === 4
      }));
      // Assign fake peers
      mnodes.forEach(n => {
        if (n.role === 'offline') return;
        const peers = mnodes.filter(p => p.role !== 'offline' && p.device_id !== n.device_id && Math.random() > 0.6);
        n.peer_ids = peers.map(p => p.device_id).slice(0, 3);
      });
      
      processNewData(mnodes);
      interval = setInterval(() => {
        const randomNode = mnodes[Math.floor(Math.random() * mnodes.length)];
        randomNode.last_seen = new Date().toISOString();
        if (randomNode.role !== 'offline') {
           randomNode.hop_count = Math.floor(Math.random() * 3);
        } else {
           if (Math.random() > 0.7) randomNode.role = 'relay';
        }
        processNewData([...mnodes]);
      }, 4000);
      
      return () => clearInterval(interval);
    } else {
      // Connect to Supabase
      const fetchInitial = async () => {
        const limitTimestamp = new Date(Date.now() - 120000).toISOString();
        let query = supabase.from('mesh_telemetry').select('*').gt('last_seen', limitTimestamp);
        if (squadId) query = query.eq('squad_id', squadId);
        
        const { data } = await query;
        if (data) processNewData(data as MeshTelemetry[]);
      };
      
      fetchInitial();
      
      channelRef.current = supabase.channel('mesh_telemetry_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'mesh_telemetry' }, payload => {
          const newDoc = payload.new as MeshTelemetry;
          if (squadId && (newDoc as any).squad_id !== squadId) return;
          processNewData([newDoc]);
        })
        .subscribe();
        
      interval = setInterval(() => {
        // Run process periodically to cull dead nodes even without events
        processNewData([]); 
      }, 10000);

      return () => {
        clearInterval(interval);
        if (channelRef.current) supabase.removeChannel(channelRef.current);
      }
    }
  }, [mockMode, squadId, updateStats]);

  // Toolbar Actions
  const handleExportPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `network-export-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const handleFitScreen = () => {
    const canvas = canvasRef.current;
    const sim = simulationRef.current;
    if (!canvas || !sim) return;
    const cw = canvas.parentElement?.clientWidth || window.innerWidth;
    d3.select(canvas).transition().duration(750).call(
      d3.zoom<HTMLCanvasElement, unknown>().transform as any, 
      d3.zoomIdentity.translate(cw/2, height/2).scale(1).translate(-cw/2, -height/2)
    );
  };

  return (
    <div className="w-full flex-col flex bg-slate-900/40 backdrop-blur-3xl border border-white/10 rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/5" ref={containerRef}>
      
      {/* Stat Bar Header */}
      <div className="flex border-b border-white/5 bg-slate-900/60 p-4 lg:px-6 items-center justify-between flex-wrap gap-4 relative z-10">
        <div className="flex items-center gap-6 lg:gap-10">
          <div className="flex flex-col">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Active Nodes</span>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-white drop-shadow-sm">{stats.active}</span>
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)] animate-pulse"></div>
            </div>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Total Edges</span>
            <span className="text-2xl font-bold text-white drop-shadow-sm">{stats.edges}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Gateways</span>
            <span className="text-2xl font-bold text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.6)]">{stats.gateways}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Avg Hops</span>
            <span className="text-2xl font-bold text-white drop-shadow-sm">{stats.avgHop}</span>
          </div>
        </div>
        
        <div className="flex gap-3">
          <div className="text-xs text-indigo-200/70 flex items-center pr-4 font-medium">
            Updated {lastUpdate.toLocaleTimeString()}
          </div>
          <select 
            value={filterMode} 
            onChange={(e) => setFilterMode(e.target.value as any)}
            className="text-sm bg-slate-800/80 border border-slate-700 rounded-md px-3 py-1 outline-none text-slate-200 font-medium hover:bg-slate-700 transition focus:ring-2 focus:ring-indigo-500/50"
          >
            <option value="all">All Nodes</option>
            <option value="gateway">Gateways Only</option>
            <option value="active">Active Only</option>
          </select>
          <button onClick={handleFitScreen} className="p-1.5 px-3 border border-white/10 rounded-md bg-white/5 hover:bg-white/10 flex items-center gap-2 text-sm text-slate-200 font-medium transition-all backdrop-blur-sm">
            <Maximize size={16} className="text-blue-400" /> Fit
          </button>
          <button onClick={handleExportPNG} className="p-1.5 px-3 border border-white/10 rounded-md bg-white/5 hover:bg-white/10 flex items-center gap-2 text-sm text-slate-200 font-medium transition-all backdrop-blur-sm">
            <Download size={16} className="text-emerald-400" /> PNG 
          </button>
        </div>
      </div>

      {/* Canvas Area */}
      <div className="w-full relative" style={{ height: `${height}px`, background: 'transparent' }}>
        
        {mockMode && (
          <div className="absolute top-4 right-4 bg-amber-900/30 text-amber-300 px-3 py-1.5 text-xs font-bold rounded-lg border border-amber-500/30 uppercase tracking-widest backdrop-blur-md z-10 shadow-lg flex items-center gap-2 pointer-events-none">
            <Activity size={14} className="animate-pulse" /> Simulation Mode
          </div>
        )}

        <canvas 
          ref={canvasRef} 
          className="cursor-grab active:cursor-grabbing outline-none" 
        />

        {/* Hover Tooltip Overlay */}
        {hoveredNode && (
          <div 
            className="absolute z-20 bg-slate-900/80 backdrop-blur-xl border border-white/10 shadow-[0_4px_30px_rgba(0,0,0,0.5)] rounded-xl p-3 pointer-events-none transform -translate-x-1/2 mt-3 text-white transition-all duration-100 ease-out"
            style={{ left: Math.max(80, Math.min(tooltipPos.x, canvasRef.current?.offsetWidth! - 80)), top: tooltipPos.y }}
          >
            <div className="flex items-center gap-2 mb-2 border-b border-slate-700 pb-2">
              <span className="text-2xl drop-shadow-lg">{hoveredNode.mascot}</span>
              <div>
                <div className="font-mono text-xs font-bold text-slate-200">{hoveredNode.device_id.slice(0, 8)}…</div>
                <div className={`text-[10px] font-bold uppercase tracking-widest ${hoveredNode.role === 'gateway' ? 'text-blue-400' : 'text-emerald-400'}`}>{hoveredNode.role}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
              <div className="text-slate-400">Peers</div>
              <div className="font-semibold text-slate-100 text-right">{hoveredNode.peer_ids?.length || 0}</div>
              
              <div className="text-slate-400">Hops</div>
              <div className="font-semibold text-slate-100 text-right">{hoveredNode.hop_count}</div>
              
              <div className="text-slate-400">Conn</div>
              <div className="font-semibold text-slate-100 text-right">{hoveredNode.conn_type?.replace('_', ' ')}</div>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="absolute bottom-6 left-6 bg-slate-900/70 backdrop-blur-md border border-white/10 shadow-xl rounded-xl p-2.5 px-4 flex gap-5 text-[11px] font-bold tracking-wider uppercase text-slate-300 z-10">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]"></div> Gateway
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></div> Relay
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2.5 rounded-full h-0 border-t-2 border-slate-500 border-dashed"></div> Offline
          </div>
        </div>
      </div>
    </div>
  );
}
