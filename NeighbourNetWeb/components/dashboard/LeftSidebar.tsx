import React, { useState } from 'react';
import { Message, PriorityTier } from '../../lib/types';
import MessageCard from './MessageCard';

interface Props {
  messages: Message[];
  onDispatch: (id: string) => Promise<void>;
  loading?: boolean;
  selectedMessageId?: string | null;
  onSelectMessage?: (id: string) => void;
}

export default function LeftSidebar({ messages, onDispatch, loading = false, selectedMessageId, onSelectMessage }: Props) {
  const [filter, setFilter] = useState<'ALL' | PriorityTier>('ALL');


  const liveCount = messages.filter(m => !m.acknowledged).length;

  const filtered = messages
    .filter(m => filter === 'ALL' || m.priority_tier === filter)
    .sort((a, b) => b.priority_score - a.priority_score);

  const tabs: Array<'ALL' | PriorityTier> = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

  return (
    <div className="skeu-panel h-full flex flex-col overflow-hidden">
      
      {/* Header */}
      <div className="p-4 border-b shrink-0 flex items-center justify-between" style={{ borderColor: 'var(--color-panel-border)' }}>
        <h2 style={{ fontFamily: 'var(--font-sans)', fontSize: '16px', fontWeight: 'bold', color: 'var(--color-text-primary)' }}>
          Active Tasks
        </h2>
        <div 
          className="px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5',
            fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 'bold'
          }}
        >
          {loading ? '…' : liveCount}
        </div>
      </div>

      {/* Filter Row */}
      <div className="px-4 py-3 shrink-0">
        <div 
          className="flex flex-row p-1 rounded"
          style={{ backgroundColor: 'var(--color-panel-border)', boxShadow: 'inset 0 1px 3px rgba(80,60,40,0.2)' }}
        >
          {tabs.map(t => {
            const isActive = filter === t;
            return (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className="flex-1 text-center py-1 rounded"
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                  backgroundColor: isActive ? 'transparent' : 'var(--color-panel-surface)',
                  boxShadow: isActive 
                    ? 'inset 0 1px 3px rgba(80,60,40,0.3)' 
                    : 'inset 0 1px 0 rgba(255,255,255,0.4), 0 2px 4px rgba(80,60,40,0.15)',
                  transition: 'all 150ms'
                }}
              >
                {t}
              </button>
            )
          })}
        </div>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-md mb-4"
              style={{
                height: '110px',
                backgroundColor: 'var(--color-panel-border)',
                opacity: 1 - i * 0.25,
              }}
            />
          ))
        ) : filtered.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center h-40"
            style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-sans)', fontSize: '13px', textAlign: 'center' }}
          >
            <span style={{ fontSize: '28px', marginBottom: '8px' }}>✓</span>
            No active tasks
            {filter !== 'ALL' && <span style={{ marginTop: '4px', fontSize: '11px' }}>in {filter} tier</span>}
          </div>
        ) : (
          filtered.map(m => (
            <MessageCard 
              key={m.message_id} 
              message={m} 
              onDispatch={onDispatch} 
              isSelected={m.message_id === selectedMessageId}
              onClick={() => onSelectMessage?.(m.message_id)}
            />
          ))
        )}
      </div>

    </div>
  );
}
