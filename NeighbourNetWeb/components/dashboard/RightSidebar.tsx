import React from 'react';
import MeshStatusPanel from './MeshStatusPanel';
import LiveMetricsPanel from './LiveMetricsPanel';
import { Message, MeshStatus } from '../../lib/types';

interface Props {
  messages: Message[];
  meshStatus: MeshStatus;
}

export default function RightSidebar({ messages, meshStatus }: Props) {
  return (
    <>
      <div className="flex-1 w-full overflow-hidden flex flex-col">
        <MeshStatusPanel meshStatus={meshStatus} messages={messages} />
      </div>
      <div className="flex-1 w-full overflow-hidden flex flex-col">
        <LiveMetricsPanel messages={messages} />
      </div>
    </>
  );
}
