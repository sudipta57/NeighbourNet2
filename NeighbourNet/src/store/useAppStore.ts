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

export interface FriendLocation {
	senderId: string
	displayName: string
	friendCode: string
	lat: number
	lng: number
	timestamp: number
	accuracy?: number
}

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
	ownDisplayName: string

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
	setOwnDisplayName: (name: string) => void

	friendLocations: FriendLocation[]
	upsertFriendLocation: (loc: FriendLocation) => void
	pruneStaleFriendLocations: () => void

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
	ownDisplayName: '',

	friends: [],
	activeChatFriend: null,
	chatMessages: {},
	friendLocations: [],

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
				// startMesh already starts discovery/scanning, so we can just refresh the count
				return await get().refreshPeerCount()
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

	setOwnDisplayName: (name) => set({ ownDisplayName: name }),

	upsertFriendLocation: (loc) =>
		set((state) => {
			const next = state.friendLocations.filter((entry) => entry.senderId !== loc.senderId)
			next.push(loc)
			return { friendLocations: next }
		}),

	pruneStaleFriendLocations: () =>
		set((state) => {
			const cutoff = Date.now() - 60000
			return {
				friendLocations: state.friendLocations.filter((entry) => entry.timestamp >= cutoff),
			}
		}),

	setFriends: (friends) => set({ friends }),

	addFriend: (friend) =>
		set((state) => {
			// Deduplicate by friend_code (primary key) and by device_uuid when known.
			const filtered = state.friends.filter(
				(f) =>
					f.friend_code !== friend.friend_code &&
					(friend.device_uuid === '' || f.device_uuid !== friend.device_uuid)
			)
			// If the chat screen is open on this friend, refresh activeChatFriend so
			// ChatScreen immediately sees the new device_uuid (fixes stale-UUID display bug).
			const active = state.activeChatFriend
			const activeIsThisFriend =
				active !== null &&
				(active.friend_code === friend.friend_code ||
					(friend.device_uuid !== '' && active.device_uuid === friend.device_uuid))
			return {
				friends: [...filtered, friend],
				activeChatFriend: activeIsThisFriend ? friend : active,
			}
		}),

	setActiveChatFriend: (friend) => set({ activeChatFriend: friend }),

	addChatMessage: (friend_uuid, msg) =>
		set((state) => {
			const existing = state.chatMessages[friend_uuid] ?? []
			if (existing.some((m) => m.id === msg.id)) {
				return state
			}
			return {
				chatMessages: {
					...state.chatMessages,
					[friend_uuid]: [...existing, msg],
				},
			}
		}),

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
