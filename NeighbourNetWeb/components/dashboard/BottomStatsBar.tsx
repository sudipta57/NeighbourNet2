import React from 'react';
import { Message, MeshStatus } from '../../lib/types';

interface Props {
  messages: Message[];
  meshStatus: MeshStatus;
}

export default function BottomStatsBar({ messages, meshStatus }: Props) {
  const totalReceived = messages.length;
  const criticalUnack = messages.filter(m => m.priority_tier === 'CRITICAL' && !m.acknowledged).length;
  const syncedGws = meshStatus.gateways.filter(g => g.status === 'online' || g.status === 'synced').length;
  const totalGws = meshStatus.gateways.length;

  return (
    <div 
      className="w-full h-full flex flex-row items-center px-6"
      style={{
        backgroundColor: '#DDD8CC',
        boxShadow: 'inset 0 2px 6px rgba(80,60,40,0.15)',
        gap: '32px'
      }}
    >
      
      {/* 1. System */}
      <div className="flex items-center gap-2 h-full">
        <div 
          className="rounded-full"
          style={{ width: '8px', height: '8px', backgroundColor: 'var(--color-positive)', boxShadow: '0 0 4px var(--color-positive)' }}
        />
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
          System: <span style={{ fontFamily: 'var(--font-mono)' }}>OPERATIONAL</span>
        </span>
      </div>

      <div className="h-4 border-l" style={{ borderColor: 'var(--color-panel-border)' }} />

      {/* 2. Messages Received */}
      <div className="flex items-center h-full">
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
          Messages received: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)' }}>{totalReceived}</span>
        </span>
      </div>

      <div className="h-4 border-l" style={{ borderColor: 'var(--color-panel-border)' }} />

      {/* 3. CRITICAL unack */}
      <div className="flex items-center h-full">
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', fontWeight: 600, color: 'var(--color-critical)' }}>
          CRITICAL unacknowledged: <span style={{ fontFamily: 'var(--font-mono)' }}>{criticalUnack}</span>
        </span>
      </div>

      <div className="h-4 border-l" style={{ borderColor: 'var(--color-panel-border)' }} />

      {/* 4. Gateways */}
      <div className="flex items-center gap-2 h-full">
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
          Gateways synced: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)' }}>{syncedGws}/{totalGws}</span>
        </span>
        <div className="flex gap-1 ml-2">
          {meshStatus.gateways.map((g, i) => (
            <div 
              key={i} 
              className="rounded-full"
              style={{
                width: '6px', height: '6px',
                backgroundColor: (g.status === 'online' || g.status === 'synced') ? 'var(--color-positive)' : 'var(--color-inactive)'
              }}
            />
          ))}
        </div>
      </div>

      <div className="h-4 border-l" style={{ borderColor: 'var(--color-panel-border)' }} />

      {/* 5. Grafana */}
      <div className="flex items-center gap-2 h-full">
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
          Grafana: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)' }}>Live</span>
        </span>
        <div 
          className="rounded-full animate-pulse"
          style={{ width: '6px', height: '6px', backgroundColor: 'var(--color-positive)' }}
        />
      </div>

      <div className="h-4 border-l" style={{ borderColor: 'var(--color-panel-border)' }} />

      {/* 6. Supabase */}
      <div className="flex items-center gap-2 h-full">
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
          Supabase Realtime: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)' }}>Connected</span>
        </span>
        <div 
          className="rounded-full animate-pulse"
          style={{ width: '6px', height: '6px', backgroundColor: 'var(--color-positive)' }}
        />
      </div>

      {/* 7. Version */}
      <div className="ml-auto h-full flex items-center">
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
          NeighbourNet v1.0 &middot; Hackathon 2026
        </span>
      </div>

    </div>
  );
}
