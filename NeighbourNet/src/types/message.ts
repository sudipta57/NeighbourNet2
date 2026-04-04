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
}

export const SOS_TEMPLATES = [
  { label: 'আটকে পড়েছি, নৌকা দরকার', labelEn: 'Trapped, need boat' },
  { label: 'চিকিৎসা জরুরি', labelEn: 'Medical emergency' },
  { label: 'খাবার ও জল নেই', labelEn: 'No food or water' },
  { label: 'বৃদ্ধ, সরতে পারছি না', labelEn: 'Elderly, cannot move' },
  { label: 'আমি ঠিক আছি', labelEn: 'Safe, checking in' },
];
