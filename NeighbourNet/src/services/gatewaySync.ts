import NetInfo, { NetInfoState, NetInfoSubscription } from '@react-native-community/netinfo';
import { Message } from '../types/message';
import { getUnsynced, markSynced } from '../db/database';
import useAppStore from '../store/useAppStore';
import { API_BASE_URL, SYNC_CHUNK_SIZE, SYNC_MAX_RETRIES } from '../constants/priorities';
import { Platform } from 'react-native';

type SyncMessage = Omit<Message, 'synced'> & {
	location_hint: string | null;
};

type BatchPayload = {
	gateway_id: string;
	messages: SyncMessage[];
};

const HARD_CODED_GATEWAY_ID = 'neighbournet-mobile-gateway';

type BatchResponse = {
	persisted_ids: string[];
	duplicate_ids?: string[];
	failed_ids?: string[];
};

type GatewayStatus = 'idle' | 'syncing' | 'success' | 'error';

class SyncRequestError extends Error {
	readonly status: number;
	readonly retryable: boolean;
	readonly responseBody: string;

	constructor(message: string, status: number, retryable: boolean, responseBody: string) {
		super(message);
		this.status = status;
		this.retryable = retryable;
		this.responseBody = responseBody;
	}
}

let netInfoUnsubscribe: NetInfoSubscription | null = null;
let isSyncing = false;
let periodicSyncTimer: ReturnType<typeof setInterval> | null = null;

const PERIODIC_SYNC_INTERVAL_MS = 15_000;

const withNoTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const getFallbackApiBaseUrls = (): string[] => {
	if (Platform.OS !== 'android') {
		return [];
	}

	const fallbacks = ['http://10.0.2.2:8000', 'http://127.0.0.1:8000'];
	return fallbacks
		.map((value) => withNoTrailingSlash(value))
		.filter((value) => value !== withNoTrailingSlash(API_BASE_URL));
};

const buildApiBaseCandidates = (): string[] => {
	const primary = withNoTrailingSlash(API_BASE_URL);
	return [primary, ...getFallbackApiBaseUrls()];
};

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

const FETCH_TIMEOUT_MS = 30_000;

const fetchWithTimeout = async (url: string, options: RequestInit): Promise<Response> => {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		return await fetch(url, { ...options, signal: controller.signal });
	} catch (error) {
		// React Native on Android throws "Network request failed" when AbortController fires
		// instead of AbortError — normalise it here so callers get a clear timeout message.
		if (controller.signal.aborted) {
			throw new Error(`Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
		}
		throw error;
	} finally {
		clearTimeout(timeoutId);
	}
};

const chunkMessages = (messages: Message[], chunkSize: number): Message[][] => {
	const chunks: Message[][] = [];

	for (let index = 0; index < messages.length; index += chunkSize) {
		chunks.push(messages.slice(index, index + chunkSize));
	}

	return chunks;
};

const toSyncMessage = (message: Message): SyncMessage => {
	return {
		message_id: message.message_id,
		body: message.body,
		sender_id: message.sender_id,
		message_type: message.message_type,
		gps_lat: message.gps_lat,
		gps_lng: message.gps_lng,
		location_hint: message.location_hint?.trim() ? message.location_hint : null,
		priority_score: message.priority_score,
		priority_tier: message.priority_tier,
		ttl: message.ttl,
		hop_count: message.hop_count,
		created_at: message.created_at,
		last_hop_at: message.last_hop_at,
	};
};

const parseResponseBody = async (response: Response): Promise<string> => {
	try {
		return await response.text();
	} catch (_error) {
		return '';
	}
};

const parsePersistedIds = (body: BatchResponse): string[] => {
	const persisted = Array.isArray(body.persisted_ids) ? body.persisted_ids : [];
	const duplicates = Array.isArray(body.duplicate_ids) ? body.duplicate_ids : [];
	return [...persisted, ...duplicates];
};

const applyPersistedIds = (persistedIds: string[]): void => {
	if (persistedIds.length === 0) {
		return;
	}

	const uniqueIds = Array.from(new Set(persistedIds));

	for (const id of uniqueIds) {
		markSynced([id]);
	}

	useAppStore.setState((state) => ({
		queueDepth: Math.max(0, state.queueDepth - uniqueIds.length),
	}));

	useAppStore.getState().refreshMessages();
	useAppStore.getState().setLastSyncTime(Date.now());
};

const setGatewayStatus = (status: GatewayStatus): void => {
	const store = useAppStore.getState();
	if (typeof store.setGatewayStatus === 'function') {
		store.setGatewayStatus(status);
		return;
	}

	if (typeof store.setSyncing === 'function') {
		store.setSyncing(status === 'syncing');
	}
};

const setOnlineState = (state: NetInfoState): void => {
	const online = state.isConnected !== false && state.isInternetReachable !== false;
	useAppStore.getState().setOnline(online);
};

const postChunk = async (messages: Message[]): Promise<string[]> => {
	const payloadMessages = messages.map(toSyncMessage);
	const payload = JSON.stringify({
		gateway_id: HARD_CODED_GATEWAY_ID,
		messages: payloadMessages,
	} satisfies BatchPayload);

	let lastError: unknown = null;
	let lastSyncError: SyncRequestError | null = null;

	for (const baseUrl of buildApiBaseCandidates()) {
		try {
			const response = await fetchWithTimeout(`${baseUrl}/api/messages/batch`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: payload,
			});

			if (!response.ok) {
				const responseBody = await parseResponseBody(response);
				throw new SyncRequestError(
					`Sync failed with HTTP ${response.status}`,
					response.status,
					response.status >= 500,
					responseBody
				);
			}

			const json = (await response.json()) as BatchResponse;
			if (baseUrl !== withNoTrailingSlash(API_BASE_URL)) {
				console.log(`[GatewaySync] Synced via fallback API base ${baseUrl}`);
			}
			return parsePersistedIds(json);
		} catch (error) {
			if (error instanceof SyncRequestError) {
				lastSyncError = error;
			}
			lastError = error;
		}
	}

	// Prefer SyncRequestError (has real HTTP status/body from the server) over a
	// generic network error that may come from unreachable fallback addresses.
	throw lastSyncError ?? lastError ?? new Error('Sync failed: no API base URL candidates available');
};

const syncChunkWithRetry = async (messages: Message[]): Promise<string[]> => {
	let retryCount = 0;

	while (true) {
		try {
			return await postChunk(messages);
		} catch (error) {
			if (error instanceof SyncRequestError && !error.retryable) {
				throw error;
			}

			if (retryCount >= SYNC_MAX_RETRIES) {
				throw error;
			}

			const backoffMs = 2000 * 2 ** retryCount;
			retryCount += 1;
			await delay(backoffMs);
		}
	}
};

const syncUnsyncedMessages = async (): Promise<void> => {
	if (isSyncing) {
		return;
	}

	const unsynced = getUnsynced();

	if (unsynced.length === 0) {
		console.log('[GatewaySync] Queue empty, skipping sync');
		return;
	}

	isSyncing = true;

	setGatewayStatus('syncing');

	const chunks = chunkMessages(unsynced, SYNC_CHUNK_SIZE);
	let hasFailure = false;

	try {
		for (const chunk of chunks) {
			try {
				const persistedIds = await syncChunkWithRetry(chunk);
				applyPersistedIds(persistedIds);
			} catch (error) {
				hasFailure = true;
				if (error instanceof SyncRequestError && error.status >= 400 && error.status < 500) {
					console.error('[GatewaySync] Validation error:', error.responseBody || error.message);
					continue;
				}

				if (error instanceof SyncRequestError) {
					console.error(`[GatewaySync] Server rejected sync HTTP ${error.status}:`, error.responseBody || error.message);
					if (!error.retryable) continue;
				}

				const message = error instanceof Error ? error.message : String(error);
				if (message.toLowerCase().includes('timed out')) {
					console.error('[GatewaySync] Request timed out — server may be slow to respond');
					console.error('[GatewaySync] Current API_BASE_URL:', API_BASE_URL);
					throw new Error(`Sync timed out: ${message}`);
				}
				if (message.toLowerCase().includes('network request failed')) {
					console.error('[GatewaySync] Network error — check device internet connectivity');
					console.error('[GatewaySync] Current API_BASE_URL:', API_BASE_URL);
					console.error('[GatewaySync] Error:', message);
					throw new Error(`Network error: ${message}`);
				}

				console.error('[GatewaySync] Chunk sync failed:', error);
			}
		}

		if (hasFailure) {
			setGatewayStatus('error');
		} else {
			setGatewayStatus('success');
		}
	} catch (error) {
		setGatewayStatus('error');
		console.error('[GatewaySync] Sync failed:', error);
	} finally {
		isSyncing = false;
	}
};

const shouldSyncFromNetworkState = (state: NetInfoState): boolean =>
	state.isConnected !== false && state.isInternetReachable !== false;

export const triggerManualSync = async (): Promise<void> => {
	const state = await NetInfo.fetch();
	setOnlineState(state);
	if (!shouldSyncFromNetworkState(state)) {
		return;
	}

	await syncUnsyncedMessages();
};

export const startGatewaySync = (): void => {
	if (netInfoUnsubscribe) {
		return;
	}

	netInfoUnsubscribe = NetInfo.addEventListener((state) => {
		setOnlineState(state);
		if (shouldSyncFromNetworkState(state)) {
			void syncUnsyncedMessages();
		}
	});

	if (!periodicSyncTimer) {
		periodicSyncTimer = setInterval(() => {
			void triggerManualSync();
		}, PERIODIC_SYNC_INTERVAL_MS);
	}

	void triggerManualSync();
};

export const stopGatewaySync = (): void => {
	if (netInfoUnsubscribe) {
		netInfoUnsubscribe();
		netInfoUnsubscribe = null;
	}

	if (periodicSyncTimer) {
		clearInterval(periodicSyncTimer);
		periodicSyncTimer = null;
	}
};
