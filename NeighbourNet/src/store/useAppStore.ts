import { create } from 'zustand'
import { Message, PriorityTier, Friend, ChatMessage } from '../types/message'
import {
	insertMessage,
	getUnsyncedMessages,
	markMessagesSynced,
	getQueueDepth,
	getAllMessages,
	isSeenMessage,
	getFriends,
} from '../db/database'
import { getConnectedPeerCount, scanNearbyPeers } from '../services/meshService'
import { startMesh } from '../services/meshService'

type GatewayStatus = 'idle' | 'syncing' | 'success' | 'error'

interface AppState {
	isMeshActive: boolean
	peerCount: number
	lastSyncAt: string | null

	messages: Message[]
	queueDepth: number

	isOnline: boolean
	isSyncing: boolean
	gatewayStatus: GatewayStatus
	lastSyncTime: number | null

	deviceId: string | null

	friends: Friend[]
	activeChatFriend: Friend | null
	chatMessages: Record<string, ChatMessage[]>

	setMeshActive: (active: boolean) => void
	setPeerCount: (count: number) => void
	refreshPeerCount: () => Promise<number>
	triggerPeerScan: () => Promise<number>

	addMessage: (message: Message) => void
	refreshMessages: () => void
	refreshQueueDepth: () => void

	setOnline: (online: boolean) => void
	setSyncing: (syncing: boolean) => void
	setLastSyncAt: (timestamp: string) => void
	setGatewayStatus: (status: GatewayStatus) => void
	setLastSyncTime: (timestamp: number) => void
	markSynced: (message_ids: string[]) => void

	setDeviceId: (id: string) => void

	setFriends: (friends: Friend[]) => void
	addFriend: (friend: Friend) => void
	setActiveChatFriend: (friend: Friend | null) => void
	addChatMessage: (friend_uuid: string, msg: ChatMessage) => void
	markChatMessageDelivered: (friend_uuid: string, message_id: string) => void
	loadFriendsFromDB: () => void
}

const useAppStore = create<AppState>()((set, get) => ({
	isMeshActive: false,
	peerCount: 0,
	lastSyncAt: null,
	messages: [],
	queueDepth: 0,
	isOnline: false,
	isSyncing: false,
	gatewayStatus: 'idle',
	lastSyncTime: null,
	deviceId: null,

	friends: [],
	activeChatFriend: null,
	chatMessages: {},

	setMeshActive: (active) => set({ isMeshActive: active }),

	setPeerCount: (count) => set({ peerCount: count }),

	refreshPeerCount: async () => {
		try {
			const count = await getConnectedPeerCount()
			set({ peerCount: count })
			return count
		} catch (error) {
			console.error('Failed to refresh peer count:', error)
			return get().peerCount
		}
	},

	triggerPeerScan: async () => {
		try {
			if (!get().isMeshActive) {
				await startMesh()
				set({ isMeshActive: true })
			}

			const count = await scanNearbyPeers()
			set({ peerCount: count })
			return count
		} catch (error) {
			console.error('Failed to trigger peer scan:', error)
			return get().peerCount
		}
	},

	addMessage: (message) => {
		try {
			const alreadySeen = isSeenMessage(message.message_id)
			if (alreadySeen) {
				return
			}

			insertMessage(message)
			get().refreshMessages()
			get().refreshQueueDepth()
		} catch (error) {
			console.error('Failed to add message:', error)
		}
	},

	refreshMessages: () => {
		try {
			const result = getAllMessages()
			set({ messages: result })
		} catch (error) {
			console.error('Failed to refresh messages:', error)
		}
	},

	refreshQueueDepth: () => {
		try {
			const result = getQueueDepth()
			set({ queueDepth: result })
		} catch (error) {
			console.error('Failed to refresh queue depth:', error)
		}
	},

	setOnline: (online) => set({ isOnline: online }),

	setSyncing: (syncing) => set({ isSyncing: syncing }),

	setLastSyncAt: (timestamp) => set({ lastSyncAt: timestamp }),

	setGatewayStatus: (status) =>
		set({
			gatewayStatus: status,
			isSyncing: status === 'syncing',
		}),

	setLastSyncTime: (timestamp) =>
		set({
			lastSyncTime: timestamp,
			lastSyncAt: new Date(timestamp).toISOString(),
		}),

	markSynced: (message_ids) => {
		try {
			markMessagesSynced(message_ids)
			get().refreshMessages()
			get().refreshQueueDepth()
			get().setLastSyncTime(Date.now())
		} catch (error) {
			console.error('Failed to mark messages as synced:', error)
		}
	},

	setDeviceId: (id) => set({ deviceId: id }),

	setFriends: (friends) => set({ friends }),

	addFriend: (friend) =>
		set((state) => ({
			friends: [
				...state.friends.filter((f) => f.device_uuid !== friend.device_uuid),
				friend,
			],
		})),

	setActiveChatFriend: (friend) => set({ activeChatFriend: friend }),

	addChatMessage: (friend_uuid, msg) =>
		set((state) => ({
			chatMessages: {
				...state.chatMessages,
				[friend_uuid]: [...(state.chatMessages[friend_uuid] ?? []), msg],
			},
		})),

	markChatMessageDelivered: (friend_uuid, message_id) =>
		set((state) => ({
			chatMessages: {
				...state.chatMessages,
				[friend_uuid]: (state.chatMessages[friend_uuid] ?? []).map((m) =>
					m.id === message_id ? { ...m, delivered: true } : m
				),
			},
		})),

	loadFriendsFromDB: () => {
		try {
			const result = getFriends()
			set({ friends: result })
		} catch (error) {
			console.error('Failed to load friends from DB:', error)
		}
	},
}))

export default useAppStore

export const usePriorityMessages = () => {
	return useAppStore((state) => ({
		critical: state.messages.filter(m => m.priority_tier === 'CRITICAL'),
		high: state.messages.filter(m => m.priority_tier === 'HIGH'),
		medium: state.messages.filter(m => m.priority_tier === 'MEDIUM'),
		low: state.messages.filter(m => m.priority_tier === 'LOW'),
	}))
}

export const useMeshStatus = () => {
	return useAppStore((state) => ({
		isMeshActive: state.isMeshActive,
		peerCount: state.peerCount,
		isOnline: state.isOnline,
		isSyncing: state.isSyncing,
		lastSyncAt: state.lastSyncAt,
		queueDepth: state.queueDepth,
	}))
}
