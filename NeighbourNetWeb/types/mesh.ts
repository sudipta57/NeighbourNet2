export type NodeRole = 'gateway' | 'relay' | 'offline';
export type ConnType = 'bluetooth' | 'wifi_direct' | 'both';

export interface MeshNode {
  id: string; // device_id from Supabase
  mascot: string;
  role: NodeRole;
  peerIds: string[];
  hopCount: number;
  connType: ConnType;
  isOrigin: boolean;
  lastSeen: Date;
  // force simulation position — set by D3, undefined until simulation runs
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null; // D3 fixed position when dragging
  fy?: number | null;
}

export interface MeshEdge {
  source: MeshNode; // D3 mutates these to be object references
  target: MeshNode;
  bidirectional: boolean;
}

export interface MeshStats {
  totalNodes: number;
  activeNodes: number;
  gatewayCount: number;
  offlineCount: number;
  totalEdges: number;
  avgHopCount: number;
  lastUpdated: Date | null;
  isLive: boolean;
}
