import React, { useEffect, useState } from 'react';
import { Message } from '../../lib/types';
import { CheckCircle2 } from 'lucide-react';

interface Props {
  message: Message;
  onDispatch: (id: string) => Promise<void>;
  isSelected?: boolean;
  onClick?: () => void;
}

const colorMap: Record<string, string> = {
  CRITICAL: 'var(--color-critical)',
  HIGH: 'var(--color-high)',
  MEDIUM: 'var(--color-medium)',
  LOW: 'var(--color-low)'
};

export default function MessageCard({ message, onDispatch, isSelected, onClick }: Props) {
  const [mounted, setMounted] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const {
    priority_tier, priority_score, body, location_hint,
    created_at, hop_count, acknowledged, message_id,
    triage_summary,
  } = message;

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 100);
    return () => clearTimeout(t);
  }, []);

  const tColor = colorMap[priority_tier] || colorMap.LOW;
  const timeStr = new Date(created_at).toLocaleTimeString('en-US', { hour12: false });
  const isCritical = priority_tier === 'CRITICAL' && !acknowledged;

  const handleDispatch = async () => {
    if (dispatching) return;
    setDispatching(true);
    try {
      await onDispatch(message_id);
    } finally {
      setDispatching(false);
    }
  };

  return (
    <div 
      onClick={onClick}
      className={`relative rounded-md mb-4 bg-[var(--color-panel-surface)] ${isCritical ? 'card-critical' : ''} ${isSelected ? 'ring-2 ring-[var(--color-text-primary)]' : ''}`}
      style={{
        borderLeft: `5px solid ${tColor}`,
        boxShadow: isSelected ? '0 4px 12px var(--color-shadow)' : '0 2px 8px var(--color-shadow), inset 0 1px 0 rgba(255,255,255,0.4)',
        border: '1px solid var(--color-panel-border)',
        borderLeftWidth: '5px',
        opacity: acknowledged ? 0.55 : 1,
        filter: acknowledged ? 'grayscale(30%)' : 'none',
        transition: 'all 300ms',
        cursor: onClick ? 'pointer' : 'default',
        transform: isSelected ? 'scale(1.02)' : 'scale(1)'
      }}
    >
      {acknowledged && (
        <CheckCircle2 color="var(--color-positive)" size={24} className="absolute top-2 right-2 opacity-50" />
      )}

      <div className="p-3">
        {/* Header row */}
        <div className="flex justify-between items-start">
          <span className={`priority-badge priority-badge--${priority_tier.toLowerCase()}`}>
            {priority_tier}
          </span>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--color-text-secondary)', textAlign: 'right' }}>
            {timeStr} &middot; ↪ {hop_count} hops
          </div>
        </div>

        {/* Content */}
        <div 
          className="mt-2"
          style={{ fontFamily: 'var(--font-serif)', fontWeight: 'bold', fontSize: '15px', color: 'var(--color-text-primary)' }}
        >
          {location_hint || message.extracted_location || '—'}
        </div>
        <div 
          className="mt-1 line-clamp-2 italic"
          style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text-secondary)' }}
        >
          {/* Show raw body text; triage_summary has already been merged into body by transformer */}
          {triage_summary ? body : body}
        </div>

        {isSelected && message.gps_lat !== null && message.gps_lng !== null && (
          <div 
            className="mt-3 p-2 rounded"
            style={{ 
              backgroundColor: 'var(--color-panel-border)', 
              fontFamily: 'var(--font-mono)', 
              fontSize: '11px',
              color: 'var(--color-text-primary)'
            }}
          >
            <div>Lat: {message.gps_lat.toFixed(6)}</div>
            <div>Lon: {message.gps_lng.toFixed(6)}</div>
          </div>
        )}

        {/* Footer row */}
        <div className="mt-4 flex items-end justify-between">
          {/* AI confidence bar */}
          <div className="w-1/2 flex flex-col">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--color-text-secondary)' }}>
              AI: {Math.round(priority_score * 100)}%
            </span>
            <div 
              style={{
                height: '6px',
                borderRadius: '3px',
                backgroundColor: 'var(--color-panel-border)',
                boxShadow: 'inset 0 1px 3px rgba(80,60,40,0.2)',
                overflow: 'hidden',
                marginTop: '4px'
              }}
            >
              <div 
                style={{
                  height: '100%',
                  backgroundColor: tColor,
                  width: mounted ? `${priority_score * 100}%` : '0%',
                  transition: 'width 600ms ease'
                }}
              />
            </div>
          </div>

          <div className="flex items-center justify-end">
            {acknowledged ? (
              <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: '12px', color: 'var(--color-positive)' }}>
                Assigned ✓
              </span>
            ) : (
              <button 
                onClick={handleDispatch}
                disabled={dispatching}
                className="skeu-button px-3 py-1 primary"
                style={{ fontSize: '12px', height: 'auto', minHeight: '28px', opacity: dispatching ? 0.7 : 1 }}
              >
                <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 600 }}>
                  {dispatching ? 'Assigning…' : '✓ Assign'}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
