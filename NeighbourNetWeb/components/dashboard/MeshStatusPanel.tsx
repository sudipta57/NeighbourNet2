import React, { useEffect, useState } from 'react';
import { Message, MeshStatus } from '../../lib/types';

interface Props {
  meshStatus: MeshStatus;
  messages: Message[];
}

export default function MeshStatusPanel({ meshStatus, messages }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const syncDate = new Date(meshStatus.last_sync_at);
  const syncTimeStr = mounted
    ? syncDate.toLocaleTimeString('en-US', { hour12: false })
    : '--:--:--';
  const pendingCount = messages.filter(m => !m.acknowledged).length;
  // Total queue comes from Prometheus gauge (queue_depth) + unacknowledged in current page
  const totalQueued = Math.max(pendingCount, meshStatus.queue_depth);

  const gaugeRadius = 45;
  const gaugeCircumference = 2 * Math.PI * gaugeRadius;
  const gaugeFillPercentage = Math.min((meshStatus.active_nodes / 1000) * 100, 100);
  const gaugeOffset = gaugeCircumference - (gaugeFillPercentage / 100) * gaugeCircumference;

  return (
    <div className="skeu-panel flex-1 flex flex-col p-4 w-full h-full mb-[10px]">
      
      <h2 style={{ fontFamily: 'var(--font-serif)', fontVariant: 'small-caps', fontSize: '16px', fontWeight: 'bold', color: 'var(--color-text-primary)', marginBottom: '16px' }}>
        📡 Mesh Network
      </h2>

      {/* Gauge */}
      <div className="flex justify-center mb-6 mt-2">
        <div 
          className="relative flex items-center justify-center bg-[var(--color-panel-surface)]"
          style={{
            width: '120px', height: '120px', borderRadius: '50%',
            boxShadow: 'inset 0 2px 6px rgba(80,60,40,0.2), 0 2px 8px var(--color-shadow)'
          }}
        >
          <svg width="100" height="100" className="transform -rotate-90">
            <circle
              cx="50" cy="50" r={gaugeRadius}
              fill="transparent"
              stroke="var(--color-panel-border)"
              strokeWidth="10"
            />
            <circle
              cx="50" cy="50" r={gaugeRadius}
              fill="transparent"
              stroke="var(--color-accent-blue)"
              strokeWidth="10"
              strokeDasharray={gaugeCircumference}
              strokeDashoffset={gaugeOffset}
              style={{ transition: 'stroke-dashoffset 0.5s ease-in-out' }}
            />
          </svg>
          <div className="absolute flex flex-col items-center justify-center">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '24px', fontWeight: 'bold', color: 'var(--color-text-primary)' }}>
              {meshStatus.active_nodes > 0 ? meshStatus.active_nodes : '—'}
            </span>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: '10px', color: 'var(--color-text-secondary)' }}>
              nodes
            </span>
          </div>
        </div>
      </div>

      {/* Gateway LEDs — derived from messages if no gateway tracking in backend */}
      <div className="flex flex-row justify-between mb-8 px-2">
        {meshStatus.gateways.length > 0 ? (
          meshStatus.gateways.map(g => {
            const isOnline = g.status === 'online';
            const isSynced = g.status === 'synced';
            return (
              <div key={g.id} className="flex flex-col items-center">
                <div 
                  className="rounded-full relative"
                  style={{
                    width: '14px', height: '14px',
                    backgroundColor: isOnline ? 'var(--color-positive)' : isSynced ? 'var(--color-high)' : 'var(--color-inactive)',
                    boxShadow: (isOnline || isSynced) ? `0 0 8px ${isOnline ? 'rgba(122,158,106,0.6)' : 'rgba(201,168,90,0.6)'}` : 'inset 0 2px 4px rgba(0,0,0,0.2)'
                  }}
                >
                  <div 
                    className="absolute w-full h-full rounded-full"
                    style={{ background: 'radial-gradient(circle at 35% 35%, rgba(255,255,255,0.5), transparent 60%)' }}
                  />
                </div>
                <span className="mt-2" style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                  {g.id}
                </span>
              </div>
            )
          })
        ) : (
          // Show active node indicator when no gateway list is available
          <div className="flex items-center gap-2">
            <div 
              className="rounded-full"
              style={{
                width: '10px', height: '10px',
                backgroundColor: meshStatus.active_nodes > 0 ? 'var(--color-positive)' : 'var(--color-inactive)',
              }}
            />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
              {meshStatus.active_nodes > 0 ? 'Nodes active' : 'No active nodes'}
            </span>
          </div>
        )}
      </div>

      <div className="mt-auto">
        <div className="sidebar-widget">
          <label style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
            Messages queued: {totalQueued}
          </label>
          <div className="queue-meter-housing">
            <div
              className="queue-meter-fill"
              style={{ width: `${Math.min((totalQueued / 500) * 100, 100)}%` }}
            />
          </div>
        </div>

        <div className="sync-readout text-center" suppressHydrationWarning>
          <span>Last sync · {syncTimeStr}</span>
        </div>
      </div>

    </div>
  );
}
