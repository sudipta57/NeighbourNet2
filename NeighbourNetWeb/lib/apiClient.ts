/**
 * NeighbourNet — Centralized API client.
 *
 * All requests to the FastAPI backend go through this module.
 * Base URL is read from NEXT_PUBLIC_API_BASE_URL (set in .env.local).
 */

const BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') || 'http://localhost:8000';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    ...options,
  });

  if (!res.ok) {
    let detail: unknown;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text();
    }
    throw new ApiError(`HTTP ${res.status} from ${path}`, res.status, detail);
  }

  // 204 No Content — nothing to parse
  if (res.status === 204) return undefined as unknown as T;

  return res.json() as Promise<T>;
}

// -------------------------------------------------------------------------
// Typed wrappers
// -------------------------------------------------------------------------

import type { MessageRaw, AcknowledgeResponse } from './types';

/** Fetch the ranked SOS queue. */
export async function fetchMessages(params?: {
  acknowledged?: boolean;
  limit?: number;
  tier?: string;
}): Promise<MessageRaw[]> {
  const qs = new URLSearchParams();
  if (params?.acknowledged !== undefined)
    qs.set('acknowledged', String(params.acknowledged));
  if (params?.limit !== undefined) qs.set('limit', String(params.limit));
  if (params?.tier) qs.set('tier', params.tier);

  const query = qs.toString() ? `?${qs.toString()}` : '';
  return request<MessageRaw[]>(`/api/messages${query}`);
}

/** Acknowledge (dispatch) a single message. */
export async function acknowledgeMessage(
  messageId: string,
): Promise<AcknowledgeResponse> {
  return request<AcknowledgeResponse>(
    `/api/messages/${encodeURIComponent(messageId)}/acknowledge`,
    { method: 'POST' },
  );
}
