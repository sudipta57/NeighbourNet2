'use client';

import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { MeshNode, MeshEdge } from '../types/mesh';

export function useMeshSimulation(nodes: MeshNode[], width: number, height: number) {
  const simulationRef = useRef<d3.Simulation<MeshNode, MeshEdge> | null>(null);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [tick, setTick] = useState(0);

  // We maintain mutable arrays internally to feed into D3
  const [positionedNodes, setPositionedNodes] = useState<MeshNode[]>([]);
  const [edges, setEdges] = useState<MeshEdge[]>([]);

  useEffect(() => {
    // Initial mount: Create simulation
    if (!simulationRef.current) {
      simulationRef.current = d3.forceSimulation<MeshNode>()
        .force('charge', d3.forceManyBody().strength(-120).distanceMax(400))
        .force('link', d3.forceLink<MeshNode, MeshEdge>()
          .id(d => d.id)
          .distance(90)
          .strength(0.8))
        .force('x', d3.forceX(width / 2).strength(0.06))
        .force('y', d3.forceY(height / 2).strength(0.06))
        .force('collide', d3.forceCollide(42).strength(0.9))
        .alphaDecay(0.02)
        .on('tick', () => {
          setTick(t => t + 1);
        });
    }

    const sim = simulationRef.current;

    // 1. Assign stored positions
    const safeNodes = nodes.map(n => ({ ...n }));
    safeNodes.forEach(n => {
      const pos = positionsRef.current.get(n.id);
      if (pos) {
        n.x = pos.x; n.y = pos.y;
      } else {
        n.x = width / 2 + (Math.random() - 0.5) * 200;
        n.y = height / 2 + (Math.random() - 0.5) * 200;
      }
    });

    // 2. Build edges from peerIds uniquely using the cloned objects!
    const currentEdges: MeshEdge[] = [];
    const edgeSet = new Set<string>();
    const nodeIds = new Set(safeNodes.map(n => n.id));

    safeNodes.forEach(node => {
      node.peerIds.forEach(peerId => {
        if (nodeIds.has(peerId)) {
          const pairKey = [node.id, peerId].sort().join('::');
          if (!edgeSet.has(pairKey)) {
            edgeSet.add(pairKey);
            currentEdges.push({ source: node, target: safeNodes.find(n => n.id === peerId)!, bidirectional: true });
          }
        }
      });
    });

    setPositionedNodes(safeNodes);
    setEdges(currentEdges);

    // 3 & 4: Update simulation
    sim.nodes(safeNodes);
    sim.force<d3.ForceLink<MeshNode, MeshEdge>>('link')?.links(currentEdges);

    // 5. Restart gently
    sim.alpha(0.3).restart();

    // Cleanup logic: usually we stop simulation on unmount completely,
    // but this useEffect runs when nodes array changes, so we just let it keep running
    // We only want to clean up if the component fully unmounts.
    return () => {
      // Intentionally not stopping here so React re-renders don't freeze the canvas
    };
  }, [nodes, width, height]);

  // Synchronize internal D3 pos -> positions ref continuously
  useEffect(() => {
    // The tick state triggers this effect to run
    positionedNodes.forEach(n => {
      if (n.x !== undefined && n.y !== undefined) {
        positionsRef.current.set(n.id, { x: n.x, y: n.y });
      }
    });
  }, [tick, positionedNodes]);

  // Cleanup on final unmount
  useEffect(() => {
    return () => {
      if (simulationRef.current) {
        simulationRef.current.stop();
      }
    };
  }, []);

  const setNodeFixed = (id: string, x: number, y: number) => {
    const node = positionedNodes.find(n => n.id === id);
    if (node) {
      node.fx = x;
      node.fy = y;
      simulationRef.current?.alphaTarget(0.1).restart();
    }
  };

  const releaseNode = (id: string) => {
    const node = positionedNodes.find(n => n.id === id);
    if (node) {
      node.fx = null;
      node.fy = null;
      simulationRef.current?.alphaTarget(0);
    }
  };

  const recenter = () => {
      simulationRef.current?.alpha(0.3).restart();
  };

  return { positionedNodes, edges, setNodeFixed, releaseNode, recenter, tick };
}
