/**
 * NeighbourNet — Data transformation layer.
 *
 * Maps raw backend MessageOut shapes to the frontend Message interface.
 * This is the single place where backend ↔ frontend type mismatches are resolved.
 */

import type { MessageRaw, Message } from './types';

/**
 * Transform a single raw backend message into the UI-ready Message shape.
 *
 * Rules applied:
 * - priority_tier: cloud_priority_tier overrides device priority_tier when available.
 * - body: triage_summary replaces raw body when available (Gemini provides cleaner phrasing).
 * - location_hint: fallback to "" when null.
 * - gps_lat / gps_lng: kept as null — MapPanel will skip markers without coordinates.
 * - synced: always true (only cloud-persisted messages are served by the API).
 * - acknowledged_at: pass-through, may be null.
 */
export function transformMessage(raw: MessageRaw): Message {
  return {
    message_id: raw.message_id,
    body: raw.triage_summary ?? raw.body,
    sender_id: raw.sender_id,
    gps_lat: raw.gps_lat,
    gps_lng: raw.gps_lng,
    location_hint: raw.location_hint ?? '',
    priority_score: raw.priority_score,
    priority_tier: raw.cloud_priority_tier ?? raw.priority_tier,
    cloud_priority_tier: raw.cloud_priority_tier,
    triage_summary: raw.triage_summary,
    extracted_location: raw.extracted_location,
    ttl: raw.ttl,
    hop_count: raw.hop_count,
    created_at: raw.created_at,
    last_hop_at: raw.last_hop_at,
    synced: true,
    acknowledged: raw.acknowledged,
    acknowledged_at: raw.acknowledged_at,
  };
}

/** Transform an array of raw messages. */
export function transformMessages(raws: MessageRaw[]): Message[] {
  return raws.map(transformMessage);
}
