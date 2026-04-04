'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { MeshNode, MeshStats } from '../types/mesh';

function rowToNode(row: any): MeshNode {
  return {
    id: row.device_id,
    mascot: row.mascot ?? '🐾',
    role: row.role ?? 'relay',
    peerIds: row.peer_ids ?? [],
    hopCount: row.hop_count ?? 0,
    connType: row.conn_type ?? 'bluetooth',
    isOrigin: row.is_origin ?? false,
    lastSeen: new Date(row.last_seen),
  };
}

export function useMeshTelemetry() {
  const [nodesMap, setNodesMap] = useState<Map<string, MeshNode>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // We use a ref so the Realtime subscription and intervals can access the latest map 
  // without needing to be re-bound on every map state change.
  const mapRef = useRef<Map<string, MeshNode>>(new Map());

  // Helper to commit map changes
  const commitMap = (updatedMap: Map<string, MeshNode>) => {
    mapRef.current = updatedMap;
    // We clone the map specifically so React sees it as a new distinct object reference and re-renders
    setNodesMap(new Map(updatedMap)); 
  };

  const simulateSpiderWeb = () => {
    const newMap = new Map<string, MeshNode>();
    const rings = [1, 6, 12, 18];
    let idCounter = 0;
    const ringNodes: MeshNode[][] = [];
    
    for (let r = 0; r < rings.length; r++) {
      const numNodes = rings[r];
      const currentRingNodes: MeshNode[] = [];
      for (let i = 0; i < numNodes; i++) {
          const id = `web-${idCounter++}`;
          const node: MeshNode = {
             id,
             mascot: r === 0 ? '👑' : ['🦊', '🐼', '🦁', '🐸', '🐢', '🦉'][i % 6],
             role: r === 0 ? 'gateway' : 'relay',
             peerIds: [],
             hopCount: r,
             connType: r === 0 ? 'both' : 'wifi_direct',
             isOrigin: r === rings.length - 1 && i === 5,
             lastSeen: new Date(),
          };
          currentRingNodes.push(node);
          newMap.set(id, node);
      }
      ringNodes.push(currentRingNodes);
    }
  
    for (let r = 0; r < rings.length; r++) {
      const currentRing = ringNodes[r];
      // Tangential
      if (r > 0) {
        for (let i = 0; i < currentRing.length; i++) {
           const next = (i + 1) % currentRing.length;
           currentRing[i].peerIds.push(currentRing[next].id);
           currentRing[next].peerIds.push(currentRing[i].id);
        }
      }
      // Radial 
      if (r > 0) {
         const prevRing = ringNodes[r - 1];
         for (let i = 0; i < currentRing.length; i++) {
            const parentIndex = Math.floor((i / currentRing.length) * prevRing.length);
            currentRing[i].peerIds.push(prevRing[parentIndex].id);
            prevRing[parentIndex].peerIds.push(currentRing[i].id);
         }
      }
    }
  
    newMap.forEach(n => { n.peerIds = Array.from(new Set(n.peerIds)); });
    commitMap(newMap);
    
    // Refresh their lastSeen continuously so they don't fade out
    if ((window as any).__spiderWebInterval) clearInterval((window as any).__spiderWebInterval);
    (window as any).__spiderWebInterval = setInterval(() => {
        const latestMap = new Map(mapRef.current);
        let changed = false;
        latestMap.forEach(n => {
           if (n.id.startsWith('web-')) { n.lastSeen = new Date(); changed = true; }
        });
        if (changed) commitMap(latestMap);
    }, 10000);
  };

  useEffect(() => {
    let mounted = true;
    const channel = supabase.channel('mesh-live');
    let stalenessInterval: NodeJS.Timeout;

    const init = async () => {
      try {
        setError(null);
        // 1. Fetch initial data (last_seen > NOW() - 2 mins)
        // Note: Supabase Postgres understands literal intervals, or we can compute timestamps.
        // It's safest to compute the limit locally to guarantee format compatibility.
        const twoMinsAgo = new Date(Date.now() - 120000).toISOString();
        
        const { data, error: fetchError } = await supabase
          .from('mesh_telemetry')
          .select('*')
          .gt('last_seen', twoMinsAgo);

        if (fetchError) throw fetchError;

        if (mounted && data) {
          const initMap = new Map<string, MeshNode>();
          data.forEach(row => {
            initMap.set(row.device_id, rowToNode(row));
          });
          commitMap(initMap);
        }

        // 2. Subscribe to Realtime
        channel
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'mesh_telemetry' },
            (payload) => {
              if (!mounted) return;
              
              const currentMap = new Map(mapRef.current);

              if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                const node = rowToNode(payload.new);
                const existing = currentMap.get(node.id);
                // Preserve D3 engine positions so we don't teleport the graph
                if (existing) {
                  node.x = existing.x;
                  node.y = existing.y;
                  node.vx = existing.vx;
                  node.vy = existing.vy;
                  node.fx = existing.fx;
                  node.fy = existing.fy;
                }
                currentMap.set(node.id, node);
              } else if (payload.eventType === 'DELETE') {
                const id = payload.old.device_id;
                currentMap.delete(id);
              }

              commitMap(currentMap);
            }
          )
          .subscribe((status) => {
            if (mounted) {
              setIsConnected(status === 'SUBSCRIBED');
              if (status === 'CHANNEL_ERROR') {
                setError('Failed to connect to real-time subscription channel.');
              }
            }
          });

      } catch (err: any) {
        if (mounted) setError(err.message || 'Failed to initialize mesh telemetry.');
      }
    };

    init();

    // 3. Staleness check every 15 seconds
    stalenessInterval = setInterval(() => {
      let changed = false;
      const currentMap = new Map(mapRef.current);
      const now = Date.now();

      for (const [id, node] of currentMap.entries()) {
        const diff = now - node.lastSeen.getTime();
        if (diff > 120000) {
          // > 120s: Delete
          currentMap.delete(id);
          changed = true;
        } else if (diff > 60000 && node.role !== 'offline') {
          // 60-120s: Mark offline visually
          currentMap.set(id, { ...node, role: 'offline' });
          changed = true;
        }
      }

      if (changed) {
        commitMap(currentMap);
      }
    }, 15000);

    return () => {
      mounted = false;
      clearInterval(stalenessInterval);
      supabase.removeChannel(channel);
    };
  }, []);

  // Compute returned values
  const nodes = useMemo(() => Array.from(nodesMap.values()), [nodesMap]);

  const stats = useMemo<MeshStats>(() => {
    let activeNodes = 0;
    let gatewayCount = 0;
    let offlineCount = 0;
    let totalHops = 0;
    let latestUpdate = 0;

    // We use a set of sorted pairings to deduce absolute undirected edge counts
    const edgeSet = new Set<string>();

    for (const node of nodes) {
      if (node.role === 'offline') {
        offlineCount++;
      } else {
        activeNodes++;
        if (node.role === 'gateway') gatewayCount++;
        totalHops += node.hopCount;
      }

      const nodeTime = node.lastSeen.getTime();
      if (nodeTime > latestUpdate) latestUpdate = nodeTime;

      node.peerIds.forEach(peerId => {
        const pair = [node.id, peerId].sort().join('::');
        edgeSet.add(pair);
      });
    }

    const avgHopCount = activeNodes > 0 ? Number((totalHops / activeNodes).toFixed(1)) : 0;

    return {
      totalNodes: nodes.length,
      activeNodes,
      gatewayCount,
      offlineCount,
      totalEdges: edgeSet.size,
      avgHopCount,
      lastUpdated: latestUpdate === 0 ? null : new Date(latestUpdate),
      isLive: isConnected
    };
  }, [nodes, isConnected]);

  return { nodes, isConnected, error, stats, simulateSpiderWeb };
}
