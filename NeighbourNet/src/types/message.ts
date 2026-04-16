export type PriorityTier = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface Message {
  message_id: string;
  body: string;
  sender_id: string;
  gps_lat: number | null;
  gps_lng: number | null;
  location_hint: string;
  priority_score: number;
  priority_tier: PriorityTier;
  ttl: number;
  hop_count: number;
  created_at: string;
  last_hop_at: string;
  synced: boolean;
  destination_id?: string;
  chat_thread_id?: string;
  message_type: 'sos' | 'chat' | 'location_beacon' | 'gps_share';
  sender_name?: string;
  shared_lat?: number;
  shared_lng?: number;
  shared_location_label?: string;
}

export interface Friend {
  friend_code: string;
  device_uuid: string;
  display_name: string;
  last_seen_at: number | null;
  hop_distance: number | null;
  added_at: number;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  friend_device_uuid: string;
  body: string;
  sender_id: string;
  is_outgoing: boolean;
  created_at: number;
  delivered: boolean;
  shared_lat?: number;
  shared_lng?: number;
  shared_location_label?: string;
}

export const SOS_TEMPLATES = [
  // Disaster
  { label: 'Trapped, need help' }, // 0
  { label: 'Medical emergency' }, // 1
  
  // Trek
  { label: 'Lost trail, need directions' }, // 2
  { label: 'Injured on trail' }, // 3

  // Concerts
  { label: 'Lost friend in crowd' }, // 4
  { label: 'Crowd crush / dangerous' }, // 5

  // Common
  { label: 'Safe, checking in' }, // 6
];
