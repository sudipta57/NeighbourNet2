import React from 'react';
import MeshNetworkVisualiser from '../../components/dashboard/MeshNetworkVisualiser';

export const metadata = {
  title: 'Mesh Network | NeighbourNet',
  description: 'Live force-directed topology of the NeighbourNet mesh network.'
};

export default function MeshPage() {
  return (
    <div className="flex flex-col min-h-screen w-full bg-slate-950 p-6 xl:p-8 overflow-hidden relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-900/20 via-slate-950/80 to-slate-950 pointer-events-none"></div>

      <div className="mb-8 flex items-center justify-between relative z-10">
        <div>
          <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-300 tracking-tighter">
            Mesh Telemetry
          </h1>
          <p className="text-sm text-slate-400 font-medium mt-1">Live peer-to-peer topology and gateway sync status.</p>
        </div>
      </div>
      <div className="flex-1 w-full flex flex-col relative z-10 drop-shadow-2xl">
        {/* Pass mockMode true by default in dev for easy presentation/testing out of the box */}
        <MeshNetworkVisualiser height={720} mockMode={process.env.NODE_ENV !== 'production'} />
      </div>
    </div>
  );
}
