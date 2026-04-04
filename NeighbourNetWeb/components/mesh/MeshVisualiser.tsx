'use client';

import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import * as d3 from 'd3';
import { useMeshSimulation } from '../../hooks/useMeshSimulation';
import { MeshNode } from '../../types/mesh';

interface Props {
  nodes: MeshNode[];
  width: number;
  height: number;
  showOffline?: boolean;
  onNodeClick?: (node: MeshNode) => void;
  className?: string;
  isLive?: boolean; 
}

export interface MeshVisualiserRef {
  resetSimulation: () => void;
  exportPNG: () => string | null;
}

const MeshVisualiser = forwardRef<MeshVisualiserRef, Props>(({
  nodes, width, height, showOffline = true, onNodeClick, className, isLive = false
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const { positionedNodes, edges, setNodeFixed, releaseNode, recenter, tick } = useMeshSimulation(nodes, width, height);
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const frameRef = useRef<number>(0);

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    resetSimulation: () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      d3.select(canvas).transition().duration(750).call(
        d3.zoom<HTMLCanvasElement, unknown>().transform as any, 
        d3.zoomIdentity
      );
      recenter();
    },
    exportPNG: () => {
      if (!canvasRef.current) return null;
      return canvasRef.current.toDataURL('image/png');
    }
  }));

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Filter nodes for rendering
    const visibleNodes = positionedNodes.filter(n => showOffline || n.role !== 'offline');
    const visibleNodeIds = new Set(visibleNodes.map(n => n.id));

    // Wait until nodes have actual coordinates to draw anything meaningful
    if (visibleNodes.length > 0 && visibleNodes[0].x === undefined) {
      return; 
    }

    const draw = () => {
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const t = transformRef.current;
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      const now = Date.now();

      // DRAW EDGES
      edges.forEach(edge => {
        const source = edge.source;
        const target = edge.target;

        if (!source.x || !source.y || !target.x || !target.y) return;
        if (!visibleNodeIds.has(source.id) || !visibleNodeIds.has(target.id)) return;

        const isGatewayEdge = source.role === 'gateway' || target.role === 'gateway';

        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);

        if (isGatewayEdge) {
          ctx.setLineDash([]);
          ctx.strokeStyle = '#185FA5';
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 0.35;
        } else {
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = '#1D9E75';
          ctx.lineWidth = 1;
          ctx.globalAlpha = 0.28;
        }
        ctx.stroke();

        if (isGatewayEdge && isLive) {
          const tPhase = (now / 1400) % 1;
          const dx = target.x - source.x;
          const dy = target.y - source.y;
          const dotX = source.x + dx * tPhase;
          const dotY = source.y + dy * tPhase;

          ctx.beginPath();
          ctx.arc(dotX, dotY, 3, 0, 2 * Math.PI);
          ctx.fillStyle = 'rgba(24, 95, 165, 0.55)';
          ctx.globalAlpha = 1.0;
          ctx.fill();
        }
      });

      ctx.setLineDash([]);
      ctx.globalAlpha = 1.0;

      // DRAW NODES
      visibleNodes.forEach(node => {
        if (!node.x || !node.y) return;

        const nodeRadius = node.role === 'gateway' ? 17 : node.role === 'relay' ? 14 : 11;

        if (node.isOrigin) {
          const pulseR = nodeRadius + 5 + 4 * Math.sin(now / 700);
          const pulseAlpha = 0.2 + 0.15 * Math.sin(now / 700);
          ctx.beginPath();
          ctx.arc(node.x, node.y, pulseR, 0, 2 * Math.PI);
          ctx.strokeStyle = `rgba(226, 75, 74, ${pulseAlpha})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        if (node.role === 'gateway') {
          const pulseR = 17 + 4 + 3 * Math.sin(now / 700 + 500);
          const pulseAlpha = 0.12 + 0.08 * Math.sin(now / 700 + 500);
          ctx.beginPath();
          ctx.arc(node.x, node.y, pulseR, 0, 2 * Math.PI);
          ctx.strokeStyle = `rgba(24, 95, 165, ${pulseAlpha})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(node.x, node.y, nodeRadius, 0, 2 * Math.PI);

        if (node.role === 'gateway') {
          ctx.fillStyle = '#185FA520';
          ctx.strokeStyle = '#185FA5';
          ctx.lineWidth = 1.5;
        } else if (node.role === 'relay') {
          ctx.fillStyle = '#1D9E7518';
          ctx.strokeStyle = '#1D9E75';
          ctx.lineWidth = 1.5;
        } else {
          ctx.fillStyle = 'transparent';
          ctx.strokeStyle = '#88878066';
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1.5;
        }
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);

        if (node.mascot) {
          ctx.font = `${nodeRadius - 2}px serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.globalAlpha = node.role === 'offline' ? 0.4 : 1.0;
          ctx.fillText(node.mascot, node.x, node.y + 1);
          ctx.globalAlpha = 1.0;
        }

        if (node.role === 'gateway') {
          ctx.font = 'bold 9px sans-serif';
          ctx.fillStyle = '#185FA5';
          ctx.fillText('GW', node.x, node.y + nodeRadius + 10);
        } else if (node.role === 'offline') {
          ctx.font = '9px sans-serif';
          ctx.fillStyle = '#888780';
          ctx.fillText('offline', node.x, node.y + nodeRadius + 10);
        }
      });

      ctx.restore();
      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameRef.current);
  }, [positionedNodes, edges, showOffline, isLive, tick]); // explicitly referencing tick forces continuous loop validity or at least rebinds nicely

  // Interaction bindings
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let dragStartX = 0;
    let dragStartY = 0;

    const findNodeAtCursor = (e: any) => {
      const [mx, my] = d3.pointer(e, canvas);
      const t = transformRef.current;
      const x = (mx - t.x) / t.k;
      const y = (my - t.y) / t.k;
      // manual distance check since we don't hold the simulation object directly here,
      // but we do have positionedNodes
      let closest: MeshNode | null = null;
      let minDistance = 20 * 20; // 20px radius squared
      for (const n of positionedNodes) {
        if (!n.x || !n.y || (n.role === 'offline' && !showOffline)) continue;
        const dx = n.x - x;
        const dy = n.y - y;
        const distSq = dx * dx + dy * dy;
        if (distSq < minDistance) {
          closest = n;
          minDistance = distSq;
        }
      }
      return closest;
    };

    const drag = d3.drag<HTMLCanvasElement, unknown>()
      .subject((e) => {
        return findNodeAtCursor({ sourceEvent: e.sourceEvent, ...e }) as any;
      })
      .on('start', (e) => {
        dragStartX = e.x;
        dragStartY = e.y;
        if (e.subject) {
          setNodeFixed(e.subject.id, e.subject.x, e.subject.y);
        }
      })
      .on('drag', (e) => {
        if (e.subject) {
          setNodeFixed(e.subject.id, e.x, e.y);
        }
      })
      .on('end', (e) => {
        if (e.subject) {
          releaseNode(e.subject.id);
          const dx = e.x - dragStartX;
          const dy = e.y - dragStartY;
          if (Math.abs(dx) < 5 && Math.abs(dy) < 5 && onNodeClick) {
            onNodeClick(e.subject); // Click without drag
          }
        }
      });

    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (e) => {
        transformRef.current = e.transform;
      });

    const sel = d3.select(canvas);
    sel.call(drag);
    sel.call(zoom);

    sel.on('mousemove', (e) => {
      const hit = findNodeAtCursor(e);
      if (hit) {
        canvas.style.cursor = 'pointer';
      } else {
        canvas.style.cursor = 'grab';
      }
    });

    sel.on('mouseup', (e) => {
      // In case drag didn't trigger
    });

    return () => {
      sel.on('.drag', null);
      sel.on('.zoom', null);
      sel.on('mousemove', null);
    };
  }, [positionedNodes, setNodeFixed, releaseNode, showOffline, onNodeClick]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(dpr, dpr);
  }, [width, height]);

  return (
    <canvas 
      ref={canvasRef} 
      className={`block outline-none bg-slate-100/30 ${className || ''}`}
    />
  );
});

MeshVisualiser.displayName = 'MeshVisualiser';
export default MeshVisualiser;
