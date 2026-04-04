/**
 * useMessages — fetches the SOS message queue from the backend and wires up
 * Supabase Realtime to push INSERT and UPDATE events to the UI in real time.
 *
 * Returns:
 *   messages   — transformed, sorted message list
 *   loading    — true on first fetch
 *   error      — non-null string if fetch has failed
 *   acknowledge — call this to dispatch a single message via the API
 *   acknowledgeAll — acknowledge every unacknowledged message in one pass
 *   refresh    — manually re-fetch (e.g. after reconnect)
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMessages, acknowledgeMessage } from '../lib/apiClient';
import { transformMessage, transformMessages } from '../lib/transformers';
import { supabase } from '../lib/supabaseClient';
import type { Message, MessageRaw } from '../lib/types';

export interface UseMessagesResult {
  messages: Message[];
  loading: boolean;
  error: string | null;
  acknowledge: (id: string) => Promise<void>;
  acknowledgeAll: () => Promise<void>;
  refresh: () => void;
}

export function useMessages(): UseMessagesResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Keep a ref to the latest messages so async callbacks don't stale-close over old state.
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;

  // -----------------------------------------------------------------------
  // Initial fetch
  // -----------------------------------------------------------------------
  const fetchAndSet = useCallback(async () => {
    try {
      setError(null);
      const raws = await fetchMessages({ acknowledged: false, limit: 200 });
      setMessages(transformMessages(raws));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    fetchAndSet();
  }, [fetchAndSet]);

  // -----------------------------------------------------------------------
  // Supabase Realtime subscription
  // -----------------------------------------------------------------------
  useEffect(() => {
    fetchAndSet();

    const channel = supabase
      .channel('messages-realtime')
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload: { new: MessageRaw }) => {
          const newMsg = transformMessage(payload.new);
          // Only add messages that are unacknowledged (match dashboard filter)
          if (!newMsg.acknowledged) {
            setMessages((prev) => {
              // Prevent duplicates in case of rapid reconnect
              if (prev.some((m) => m.message_id === newMsg.message_id)) return prev;
              return [newMsg, ...prev];
            });
          }
        },
      )
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload: { new: MessageRaw }) => {
          const updated = transformMessage(payload.new);
          setMessages((prev) =>
            prev.map((m) => (m.message_id === updated.message_id ? updated : m)),
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAndSet]);

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  /** Optimistically mark as acknowledged, then call the API. */
  const acknowledge = useCallback(async (id: string) => {
    // Optimistic update
    setMessages((prev) =>
      prev.map((m) =>
        m.message_id === id
          ? { ...m, acknowledged: true, acknowledged_at: new Date().toISOString() }
          : m,
      ),
    );

    try {
      await acknowledgeMessage(id);
    } catch (err) {
      // Roll back on failure
      setMessages((prev) =>
        prev.map((m) =>
          m.message_id === id ? { ...m, acknowledged: false, acknowledged_at: null } : m,
        ),
      );
      console.error('[useMessages] acknowledge failed:', err);
    }
  }, []);

  /** Acknowledge every currently unacknowledged message. */
  const acknowledgeAll = useCallback(async () => {
    const unacked = messagesRef.current.filter((m) => !m.acknowledged);
    // Optimistic bulk update
    setMessages((prev) =>
      prev.map((m) =>
        m.acknowledged
          ? m
          : { ...m, acknowledged: true, acknowledged_at: new Date().toISOString() },
      ),
    );

    const results = await Promise.allSettled(
      unacked.map((m) => acknowledgeMessage(m.message_id)),
    );

    // Roll back any that failed
    const failedIds = new Set(
      results
        .map((r, i) => (r.status === 'rejected' ? unacked[i].message_id : null))
        .filter(Boolean) as string[],
    );

    if (failedIds.size > 0) {
      setMessages((prev) =>
        prev.map((m) =>
          failedIds.has(m.message_id)
            ? { ...m, acknowledged: false, acknowledged_at: null }
            : m,
        ),
      );
      console.error('[useMessages] acknowledgeAll — some failed:', failedIds);
    }
  }, []);

  return { messages, loading, error, acknowledge, acknowledgeAll, refresh };
}
