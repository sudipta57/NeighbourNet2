'use client';

import React from 'react';
import Header from '../../components/dashboard/Header';
import LeftSidebar from '../../components/dashboard/LeftSidebar';
import RightSidebar from '../../components/dashboard/RightSidebar';
import BottomStatsBar from '../../components/dashboard/BottomStatsBar';
import dynamic from 'next/dynamic';
import { useMessages } from '../../hooks/useMessages';
import { useMeshStatus } from '../../hooks/useMeshStatus';

const MapPanel = dynamic(() => import('../../components/dashboard/MapPanel'), { ssr: false });

export default function DashboardPage() {
  const { messages, loading, error, acknowledge, acknowledgeAll } = useMessages();
  const meshStatus = useMeshStatus();
  const [selectedMessageId, setSelectedMessageId] = React.useState<string | null>(null);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden" style={{ backgroundColor: 'var(--color-bg-base)' }}>
      {/* Error Banner */}
      {error && (
        <div
          style={{
            background: 'var(--color-critical)',
            color: 'white',
            fontFamily: 'var(--font-sans)',
            fontSize: '12px',
            padding: '4px 16px',
            textAlign: 'center',
          }}
        >
          ⚠ API Error: {error} — showing last known data
        </div>
      )}

      <div style={{ height: '64px' }} className="shrink-0 w-full">
        <Header
          meshStatus={meshStatus}
          onAcknowledgeAll={acknowledgeAll}
        />
      </div>

      <div className="flex flex-row flex-1 overflow-hidden" style={{ height: 'calc(100vh - 104px)' }}>
        <div style={{ width: '22vw' }} className="h-full flex flex-col pt-4 pl-4 pb-4 shrink-0">
          <LeftSidebar 
            messages={messages} 
            onDispatch={acknowledge} 
            loading={loading} 
            selectedMessageId={selectedMessageId}
            onSelectMessage={setSelectedMessageId}
          />
        </div>

        <div style={{ width: '50vw' }} className="h-full relative p-4 shrink-0">
          <MapPanel 
            messages={messages} 
            meshStatus={meshStatus} 
            selectedMessageId={selectedMessageId} 
          />
        </div>

        <div style={{ width: '28vw' }} className="h-full flex flex-col pt-4 pr-4 pb-4 shrink-0">
          <RightSidebar messages={messages} meshStatus={meshStatus} />
        </div>
      </div>

      <div style={{ height: '40px' }} className="shrink-0 w-full">
        <BottomStatsBar messages={messages} meshStatus={meshStatus} />
      </div>
    </div>
  );
}
