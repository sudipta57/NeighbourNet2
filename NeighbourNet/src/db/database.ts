import 'react-native-get-random-values';
import * as SQLite from 'expo-sqlite';
import { Message, PriorityTier } from '../types/message';
import { MAX_QUEUE_SIZE } from '../constants/priorities';
import { getItemAsync, setItemAsync } from 'expo-secure-store';
import { v4 as uuidv4 } from 'uuid';

const db = SQLite.openDatabaseSync('neighbournet.db');

export function initDatabase(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS messages (
      message_id TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      gps_lat REAL,
      gps_lng REAL,
      location_hint TEXT DEFAULT '',
      priority_score REAL NOT NULL DEFAULT 0,
      priority_tier TEXT NOT NULL DEFAULT 'LOW',
      ttl INTEGER NOT NULL DEFAULT 10,
      hop_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_hop_at TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS seen_ids (
      message_id TEXT PRIMARY KEY,
      seen_at TEXT NOT NULL
    );
  `);
}

export function insertMessage(message: Message): void {
  // Check current count of rows in messages table
  const countResult = db.getFirstSync<{ count: number }>(
    'SELECT COUNT(*) as count FROM messages'
  );

  const count = countResult?.count ?? 0;

  // If count >= MAX_QUEUE_SIZE, delete the lowest priority_score row where priority_tier != 'CRITICAL'
  if (count >= MAX_QUEUE_SIZE) {
    db.runSync(
      `DELETE FROM messages WHERE message_id = (
        SELECT message_id FROM messages 
        WHERE priority_tier != 'CRITICAL' 
        ORDER BY priority_score ASC 
        LIMIT 1
      )`
    );
  }

  // Insert the message using INSERT OR IGNORE INTO messages
  db.runSync(
    `INSERT OR IGNORE INTO messages (
      message_id, body, sender_id, gps_lat, gps_lng, location_hint,
      priority_score, priority_tier, ttl, hop_count, created_at, last_hop_at, synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.message_id,
      message.body,
      message.sender_id,
      message.gps_lat ?? null,
      message.gps_lng ?? null,
      message.location_hint,
      message.priority_score,
      message.priority_tier,
      message.ttl,
      message.hop_count,
      message.created_at,
      message.last_hop_at,
      0, // synced = false (0)
    ]
  );

  // Also insert message_id into seen_ids table with current ISO timestamp
  const now = new Date().toISOString();
  db.runSync(
    'INSERT OR IGNORE INTO seen_ids (message_id, seen_at) VALUES (?, ?)',
    [message.message_id, now]
  );
}

export function saveMessage(message: Message): void {
  insertMessage(message);
}

export function isSeenMessage(message_id: string): boolean {
  const result = db.getFirstSync<{ count: number }>(
    'SELECT COUNT(*) as count FROM seen_ids WHERE message_id = ?',
    [message_id]
  );

  return (result?.count ?? 0) > 0;
}

export function getUnsyncedMessages(): Message[] {
  const results = db.getAllSync<{
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
    synced: number;
  }>('SELECT * FROM messages WHERE synced = 0 ORDER BY priority_score DESC');

  return results.map((row) => ({
    ...row,
    synced: row.synced === 1, // Map the synced column: 0 = false, 1 = true
  }));
}

export function getUnsynced(): Message[] {
  return getUnsyncedMessages();
}

export function markMessagesSynced(message_ids: string[]): void {
  // If array is empty, return immediately
  if (message_ids.length === 0) {
    return;
  }

  // Create a parameterized query with placeholders
  const placeholders = message_ids.map(() => '?').join(',');

  // Run UPDATE messages SET synced = 1 WHERE message_id IN (...)
  db.runSync(
    `UPDATE messages SET synced = 1 WHERE message_id IN (${placeholders})`,
    message_ids
  );
}

export function markSynced(message_ids: string[]): void {
  markMessagesSynced(message_ids);
}

export function getQueueDepth(): number {
  const result = db.getFirstSync<{ count: number }>(
    'SELECT COUNT(*) as count FROM messages WHERE synced = 0'
  );

  return result?.count ?? 0;
}

export function getAllMessages(): Message[] {
  const results = db.getAllSync<{
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
    synced: number;
  }>('SELECT * FROM messages ORDER BY priority_score DESC');

  return results.map((row) => ({
    ...row,
    synced: row.synced === 1, // Map the synced column: 0 = false, 1 = true
  }));
}

export function clearSyncedMessages(): void {
  db.runSync('DELETE FROM messages WHERE synced = 1');
}

export async function getDeviceId(): Promise<string> {
  try {
    // Check if 'device_uuid' exists in secure store
    const existingUuid = await getItemAsync('device_uuid');

    if (existingUuid) {
      return existingUuid;
    }

    // Generate a new UUID using react-native-uuid
    const newUuid = uuidv4() as string;

    // Save it to secure store
    await setItemAsync('device_uuid', newUuid);

    return newUuid;
  } catch (error) {
    console.error('Error managing device UUID:', error);
    throw error;
  }
}

export default initDatabase;
