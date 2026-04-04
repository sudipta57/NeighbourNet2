export type PriorityTier = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

// Raw shape returned by GET /api/messages — matches backend MessageOut exactly.
export interface MessageRaw {
  message_id: string;
  body: string;
  sender_id: string;
  gps_lat: number | null;
  gps_lng: number | null;
  location_hint: string | null;
  priority_score: number;
  priority_tier: PriorityTier;
  // Cloud-refined fields (populated by Gemini worker, may be null until worker runs)
  cloud_priority_tier: PriorityTier | null;
  triage_summary: string | null;
  extracted_location: string | null;
  ttl: number;
  hop_count: number;
  created_at: string;
  last_hop_at: string;
  acknowledged: boolean;
  acknowledged_at: string | null;
}

// Transformed shape consumed by all dashboard UI components.
export interface Message {
  message_id: string;
  body: string;                         // triage_summary if available, else raw body
  sender_id: string;
  gps_lat: number | null;               // null = no GPS, filtered from map
  gps_lng: number | null;
  location_hint: string;                // fallback ""
  priority_score: number;
  priority_tier: PriorityTier;          // cloud_priority_tier if available, else device tier
  cloud_priority_tier: PriorityTier | null;
  triage_summary: string | null;
  extracted_location: string | null;
  ttl: number;
  hop_count: number;
  created_at: string;
  last_hop_at: string;
  synced: boolean;                      // always true for cloud-sourced data
  acknowledged: boolean;
  acknowledged_at: string | null;
}

export interface MeshStatus {
  active_nodes: number;
  queue_depth: number;
  gateways: { id: string; status: 'online' | 'synced' | 'offline'; last_sync: string }[];
  last_sync_at: string;
  has_active_gateways: boolean;
}

export interface AcknowledgeResponse {
  message_id: string;
  acknowledged: boolean;
  acknowledged_at: string;
}

export interface MeshTelemetry {
  device_id: string;
  mascot: string;
  role: 'gateway' | 'relay' | 'offline';
  peer_ids: string[];
  hop_count: number;
  last_seen: string;
  conn_type: 'bluetooth' | 'wifi_direct' | 'both';
  is_origin: boolean;
}
