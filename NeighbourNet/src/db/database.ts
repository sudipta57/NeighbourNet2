import 'react-native-get-random-values';
import * as SQLite from 'expo-sqlite';
import { Message, PriorityTier, Friend, ChatMessage } from '../types/message';
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

    CREATE TABLE IF NOT EXISTS friends (
      friend_code TEXT PRIMARY KEY,
      device_uuid TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL DEFAULT '',
      last_seen_at INTEGER,
      hop_distance INTEGER,
      added_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      friend_device_uuid TEXT NOT NULL,
      body TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      is_outgoing INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      delivered INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_chat_thread
      ON chat_messages(thread_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_chat_friend
      ON chat_messages(friend_device_uuid, created_at DESC);
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
    synced: row.synced === 1,
    message_type: 'sos' as const,
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
    synced: row.synced === 1,
    message_type: 'sos' as const,
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

// --- Friends ---

export function saveFriend(friend: Friend): void {
  db.runSync(
    `INSERT OR REPLACE INTO friends
      (friend_code, device_uuid, display_name, last_seen_at, hop_distance, added_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
    [
      friend.friend_code,
      friend.device_uuid,
      friend.display_name,
      friend.last_seen_at ?? null,
      friend.hop_distance ?? null,
      friend.added_at,
    ]
  );
}

export function getFriends(): Friend[] {
  return db.getAllSync<Friend>(
    'SELECT * FROM friends ORDER BY last_seen_at DESC'
  );
}

export function getFriendByCode(code: string): Friend | null {
  return db.getFirstSync<Friend>(
    'SELECT * FROM friends WHERE friend_code = ?',
    [code]
  ) ?? null;
}

export function getFriendByUUID(uuid: string): Friend | null {
  return db.getFirstSync<Friend>(
    'SELECT * FROM friends WHERE device_uuid = ?',
    [uuid]
  ) ?? null;
}

export function updateFriendLastSeen(
  device_uuid: string,
  last_seen_at: number,
  hop_distance: number
): void {
  db.runSync(
    'UPDATE friends SET last_seen_at = ?, hop_distance = ? WHERE device_uuid = ?',
    [last_seen_at, hop_distance, device_uuid]
  );
}

// --- Chat Messages ---

export function saveChatMessage(msg: ChatMessage): void {
  db.runSync(
    `INSERT OR IGNORE INTO chat_messages
      (id, thread_id, friend_device_uuid, body, sender_id, is_outgoing, created_at, delivered)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      msg.id,
      msg.thread_id,
      msg.friend_device_uuid,
      msg.body,
      msg.sender_id,
      msg.is_outgoing ? 1 : 0,
      msg.created_at,
      msg.delivered ? 1 : 0,
    ]
  );
}

export function getChatHistory(
  friend_device_uuid: string,
  limit: number = 50
): ChatMessage[] {
  const rows = db.getAllSync<{
    id: string;
    thread_id: string;
    friend_device_uuid: string;
    body: string;
    sender_id: string;
    is_outgoing: number;
    created_at: number;
    delivered: number;
  }>(
    `SELECT * FROM chat_messages
      WHERE friend_device_uuid = ?
      ORDER BY created_at DESC
      LIMIT ?`,
    [friend_device_uuid, limit]
  );
  return rows
    .map((row) => ({
      ...row,
      is_outgoing: row.is_outgoing === 1,
      delivered: row.delivered === 1,
    }))
    .reverse();
}

export function markDelivered(message_id: string): void {
  db.runSync(
    'UPDATE chat_messages SET delivered = 1 WHERE id = ?',
    [message_id]
  );
}

export function getUndeliveredOutgoing(
  friend_device_uuid: string
): ChatMessage[] {
  const rows = db.getAllSync<{
    id: string;
    thread_id: string;
    friend_device_uuid: string;
    body: string;
    sender_id: string;
    is_outgoing: number;
    created_at: number;
    delivered: number;
  }>(
    `SELECT * FROM chat_messages
      WHERE friend_device_uuid = ?
      AND is_outgoing = 1
      AND delivered = 0`,
    [friend_device_uuid]
  );
  return rows.map((row) => ({
    ...row,
    is_outgoing: row.is_outgoing === 1,
    delivered: row.delivered === 1,
  }));
}

export default initDatabase;
