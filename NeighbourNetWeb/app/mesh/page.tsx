import React from 'react';
import MeshNetworkVisualiser from '../../components/dashboard/MeshNetworkVisualiser';

export const metadata = {
  title: 'Mesh Network | NeighbourNet',
  description: 'Live force-directed topology of the NeighbourNet mesh network.'
};

export default function MeshPage() {
  return (
    <div className="flex flex-col min-h-screen w-full bg-slate-50 p-6 overflow-hidden">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Mesh Telemetry</h1>
          <p className="text-sm text-slate-500 font-medium mt-1">Live peer-to-peer topology and gateway sync status.</p>
        </div>
      </div>
      <div className="flex-1 w-full flex flex-col">
        {/* Pass mockMode true by default in dev for easy presentation/testing out of the box */}
        <MeshNetworkVisualiser height={720} mockMode={process.env.NODE_ENV !== 'production'} />
      </div>
    </div>
  );
}
