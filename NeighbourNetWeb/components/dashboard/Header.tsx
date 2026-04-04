import React, { useEffect, useState } from 'react';
import { MeshStatus } from '../../lib/types';

interface HeaderProps {
  meshStatus: MeshStatus;
  onAcknowledgeAll: () => Promise<void>;
}

export default function Header({ meshStatus, onAcknowledgeAll }: HeaderProps) {
  const [syncedRecently, setSyncedRecently] = useState(true);
  const [acking, setAcking] = useState(false);
  // Track whether we are client-side to avoid SSR hydration mismatch on the clock.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const handleAcknowledgeAll = async () => {
    if (acking) return;
    setAcking(true);
    try {
      await onAcknowledgeAll();
    } finally {
      setAcking(false);
    }
  };

  useEffect(() => {
    const checkSync = () => {
      const diff = Date.now() - new Date(meshStatus.last_sync_at).getTime();
      setSyncedRecently(diff < 120000); // < 2 mins
    };
    checkSync();
    const intv = setInterval(checkSync, 10000);
    return () => clearInterval(intv);
  }, [meshStatus.last_sync_at]);

  const syncDate = new Date(meshStatus.last_sync_at);
  // Only format on client — locale time differs between SSR and browser.
  const syncTimeStr = mounted
    ? syncDate.toLocaleTimeString('en-US', { hour12: false })
    : '--:--:--';

  return (
    <div 
      className="h-full flex flex-row items-center justify-between px-6 z-50 relative"
      style={{
        backgroundColor: 'var(--color-panel-surface)',
        borderBottom: '1px solid var(--color-panel-border)',
        boxShadow: '0 4px 12px var(--color-shadow)'
      }}
    >
      {/* Left */}
      <div className="flex flex-col">
        <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 'bold', fontSize: '20px', color: 'var(--color-text-primary)' }}>
          NeighbourNet
        </div>
        <div style={{ fontFamily: 'var(--font-sans)', fontSize: '11px', fontVariant: 'small-caps', letterSpacing: '0.05em', color: 'var(--color-text-secondary)' }}>
          NDRF District Control &middot; West Bengal
        </div>
      </div>

      {/* Center */}
      <div 
        className="flex items-center px-6 py-2 rounded"
        style={{
          border: '1px solid var(--color-high)',
          boxShadow: '0 0 12px rgba(201,168,90,0.4), inset 0 2px 4px rgba(0,0,0,0.05)',
          backgroundColor: 'var(--color-panel-surface)',
        }}
      >
        <span 
          style={{
            fontFamily: 'var(--font-serif)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            fontWeight: 600,
            fontSize: '14px',
            color: 'var(--color-text-primary)'
          }}
        >
          ⚡ CYCLONE DANA — ACTIVE INCIDENT
        </span>
      </div>

      {/* Right */}
      <div className="flex flex-row items-center gap-6">
        
        {/* Sync Display */}
        <div className="flex flex-col items-end">
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: '10px', fontVariant: 'small-caps', color: 'var(--color-text-secondary)' }}>
            Last sync
          </span>
          <div className="flex items-center gap-2 mt-0.5">
            <div 
              className="rounded-full animate-pulse" 
              style={{
                width: '10px', height: '10px',
                backgroundColor: syncedRecently ? 'var(--color-positive)' : 'var(--color-high)'
              }}
            />
            <span suppressHydrationWarning style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 600 }}>
              {syncTimeStr}
            </span>
          </div>
        </div>

        {/* Node Counter */}
        <div 
          className="skeu-panel flex flex-col items-center justify-center px-4 py-1"
          style={{ boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.1), 0 2px 4px var(--color-shadow)' }}
        >
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: '10px', fontVariant: 'small-caps', color: 'var(--color-text-secondary)' }}>
            Active Nodes
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '20px', fontWeight: 'bold' }}>
            {meshStatus.active_nodes}
          </span>
        </div>

        {/* Action Button */}
        <button 
          onClick={handleAcknowledgeAll}
          disabled={acking}
          className="skeu-button px-4 py-2"

        >
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', fontVariant: 'small-caps', fontWeight: 600 }}>
            Acknowledge All
          </span>
        </button>

      </div>
    </div>
  );
}
