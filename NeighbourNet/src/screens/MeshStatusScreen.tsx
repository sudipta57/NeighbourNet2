import React, { useEffect, useCallback } from 'react'
import {
	View,
	Text,
	ScrollView,
	StyleSheet,
	SafeAreaView,
	StatusBar,
	RefreshControl,
	TouchableOpacity,
	FlatList,
	ActivityIndicator,
} from 'react-native'
import { useState } from 'react'
import useAppStore from '../store/useAppStore'
import { triggerManualSync } from '../services/gatewaySync'
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../constants/priorities'
import { Message, PriorityTier } from '../types/message'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { MeshStackParamList } from '../navigation/AppNavigator'

const formatTwoDigit = (value: number): string => value.toString().padStart(2, '0')

const getTimePart = (date: Date): string => {
	return `${formatTwoDigit(date.getHours())}:${formatTwoDigit(date.getMinutes())}`
}

const isSameDay = (first: Date, second: Date): boolean => {
	return (
		first.getFullYear() === second.getFullYear() &&
		first.getMonth() === second.getMonth() &&
		first.getDate() === second.getDate()
	)
}

export const formatTimestamp = (iso: string | null): string => {
	if (iso === null) {
		return 'Never'
	}

	try {
		const date = new Date(iso)
		if (Number.isNaN(date.getTime())) {
			throw new Error('Invalid date string')
		}

		const now = new Date()
		if (isSameDay(date, now)) {
			return `Today at ${getTimePart(date)}`
		}

		const yesterday = new Date(now)
		yesterday.setDate(now.getDate() - 1)
		if (isSameDay(date, yesterday)) {
			return `Yesterday at ${getTimePart(date)}`
		}

		return `${formatTwoDigit(date.getDate())}/${formatTwoDigit(date.getMonth() + 1)}/${date.getFullYear()} ${getTimePart(date)}`
	} catch (_error) {
		return 'Unknown'
	}
}

export const formatRelativeTime = (iso: string): string => {
	try {
		const date = new Date(iso)
		if (Number.isNaN(date.getTime())) {
			throw new Error('Invalid date string')
		}

		const now = Date.now()
		const diffSeconds = Math.max(0, Math.floor((now - date.getTime()) / 1000))

		if (diffSeconds < 60) {
			return 'just now'
		}

		const diffMinutes = Math.floor(diffSeconds / 60)
		if (diffMinutes < 60) {
			return `${diffMinutes} min ago`
		}

		const diffHours = Math.floor(diffMinutes / 60)
		if (diffHours < 24) {
			return `${diffHours} hr ago`
		}

		const diffDays = Math.floor(diffHours / 24)
		return `${diffDays} days ago`
	} catch (_error) {
		return 'Unknown'
	}
}

export const getPriorityIcon = (tier: PriorityTier): string => {
	switch (tier) {
		case 'CRITICAL':
			return '🔴'
		case 'HIGH':
			return '🟠'
		case 'MEDIUM':
			return '🟢'
		case 'LOW':
		default:
			return '⚪'
	}
}

const getBadgeBackground = (hexColor: string): string => {
	try {
		const sanitized = hexColor.replace('#', '')
		if (sanitized.length !== 6) {
			return 'rgba(84, 110, 122, 0.15)'
		}

		const red = Number.parseInt(sanitized.slice(0, 2), 16)
		const green = Number.parseInt(sanitized.slice(2, 4), 16)
		const blue = Number.parseInt(sanitized.slice(4, 6), 16)

		if ([red, green, blue].some(Number.isNaN)) {
			return 'rgba(84, 110, 122, 0.15)'
		}

		return `rgba(${red}, ${green}, ${blue}, 0.15)`
	} catch (_error) {
		return 'rgba(84, 110, 122, 0.15)'
	}
}

interface StatCardProps {
	label: string
	value: string | number
	color?: string
	subtitle?: string
	onPress?: () => void
}


const StatCard = ({ label, value, color = '#1A237E', subtitle, onPress }: StatCardProps) => {
	if (!onPress) {
		return (
			<View style={styles.statCard}>
				<Text style={[styles.statValue, { color }]}>{value}</Text>
				<Text style={styles.statLabel}>{label}</Text>
				{subtitle ? <Text style={styles.statSubtitle}>{subtitle}</Text> : null}
			</View>
		)
	}

	return (
		<TouchableOpacity
			style={[styles.statCard, styles.statCardTouchable]}
			onPress={onPress}
			activeOpacity={0.85}
			accessibilityRole="button"
		>
			<Text style={[styles.statValue, { color }]}>{value}</Text>
			<Text style={styles.statLabel}>{label}</Text>
			{subtitle ? <Text style={styles.statSubtitle}>{subtitle}</Text> : null}
		</TouchableOpacity>
	)
}

interface MessageCardProps {
	message: Message
}

const MessageCard = ({ message }: MessageCardProps) => {
	const priorityColor = PRIORITY_COLORS[message.priority_tier]
	const locationText =
		message.gps_lat !== null
			? '📍 GPS attached'
			: message.location_hint
				? `📍 ${message.location_hint}`
				: '📍 No location'

	return (
		<View style={[styles.messageCard, { borderLeftColor: priorityColor }]}> 
			<View style={styles.messageTopRow}>
				<View style={styles.priorityWrap}>
					<Text style={styles.priorityEmoji}>{getPriorityIcon(message.priority_tier)}</Text>
					<Text style={[styles.priorityLabel, { color: priorityColor }]}>
						{PRIORITY_LABELS[message.priority_tier]}
					</Text>
				</View>
				<Text style={styles.messageMetaText}>{formatRelativeTime(message.created_at)}</Text>
			</View>

			<Text style={styles.messageBody} numberOfLines={2}>
				{message.body}
			</Text>

			<View style={styles.messageBottomRow}>
				<Text style={styles.messageMetaText}>{locationText}</Text>
				<View style={styles.messageBottomRight}>
					<Text style={styles.messageMetaText}>Hop {message.hop_count}</Text>
					<Text style={[styles.messageMetaText, message.synced ? styles.syncedText : styles.queuedText]}>
						{message.synced ? '✓ Synced' : '⏳ Queued'}
					</Text>
				</View>
			</View>
		</View>
	)
}

type MeshStatusScreenProps = NativeStackScreenProps<MeshStackParamList, 'MeshStatus'>

const MeshStatusScreen = ({ navigation }: MeshStatusScreenProps) => {
	const [isRefreshing, setIsRefreshing] = useState(false)
	const [isScanningPeers, setIsScanningPeers] = useState(false)
	const [syncFeedback, setSyncFeedback] = useState<string | null>(null)
	const [activeTab, setActiveTab] = useState<'all' | 'unsynced' | 'critical'>('all')

	const isMeshActive = useAppStore((state) => state.isMeshActive)
	const peerCount = useAppStore((state) => state.peerCount)
	const isOnline = useAppStore((state) => state.isOnline)
	const isSyncing = useAppStore((state) => state.isSyncing)
	const lastSyncAt = useAppStore((state) => state.lastSyncAt)
	const queueDepth = useAppStore((state) => state.queueDepth)
	const messages = useAppStore((state) => state.messages)

	useEffect(() => {
		useAppStore.getState().refreshMessages()
		useAppStore.getState().refreshQueueDepth()
		void useAppStore.getState().triggerPeerScan()
	}, [])

	const handleScanPeers = useCallback(async () => {
		setIsScanningPeers(true)
		try {
			await useAppStore.getState().triggerPeerScan()
		} finally {
			setIsScanningPeers(false)
		}
	}, [])

	const critical = messages.filter((message) => message.priority_tier === 'CRITICAL')
	const high = messages.filter((message) => message.priority_tier === 'HIGH')
	const medium = messages.filter((message) => message.priority_tier === 'MEDIUM')
	const low = messages.filter((message) => message.priority_tier === 'LOW')

	const allMessages = [...critical, ...high, ...medium, ...low]
	const unsyncedMessages = allMessages.filter((message) => !message.synced)
	const displayedMessages =
		activeTab === 'all' ? allMessages : activeTab === 'unsynced' ? unsyncedMessages : critical

	const handleRefresh = useCallback(async () => {
		setIsRefreshing(true)
		try {
			useAppStore.getState().refreshMessages()
			useAppStore.getState().refreshQueueDepth()
		} finally {
			setIsRefreshing(false)
		}
	}, [])

	const handleManualSync = useCallback(async () => {
		if (!isOnline) {
			setSyncFeedback('Offline: connect to internet to upload queued messages')
			return
		}

		setSyncFeedback(null)

		try {
			await triggerManualSync()
			useAppStore.getState().refreshMessages()
			useAppStore.getState().refreshQueueDepth()

			const remaining = useAppStore.getState().queueDepth
			if (remaining === 0) {
				setSyncFeedback('Sync complete: all queued messages uploaded')
			} else {
				setSyncFeedback(`Sync finished: ${remaining} message(s) still queued`)
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			setSyncFeedback(`Sync failed: ${message}`)
		}
	}, [isOnline])

	const tierBadges: Array<{ tier: PriorityTier; count: number }> = [
		{ tier: 'CRITICAL', count: critical.length },
		{ tier: 'HIGH', count: high.length },
		{ tier: 'MEDIUM', count: medium.length },
		{ tier: 'LOW', count: low.length },
	]

	void FlatList

	return (
		<SafeAreaView style={styles.container}>
			<StatusBar barStyle="light-content" backgroundColor="#1A237E" />

			<View style={styles.header}>
				<View>
					<Text style={styles.headerTitle}>Mesh Status</Text>
					<Text style={styles.headerSubtitle}>Network & Queue Monitor</Text>
				</View>
				<View style={styles.headerStatusWrap}>
					<Text style={styles.headerStatusDot}>{isMeshActive ? '🟢' : '⚫'}</Text>
					<Text style={styles.headerStatusText}>{isMeshActive ? 'Active' : 'Offline'}</Text>
				</View>
			</View>

			<ScrollView
				contentContainerStyle={styles.contentContainer}
				scrollEventThrottle={16}
				keyboardShouldPersistTaps="handled"
				nestedScrollEnabled
				refreshControl={
					<RefreshControl
						refreshing={isRefreshing}
						onRefresh={handleRefresh}
						tintColor="#1A237E"
						colors={['#1A237E']}
					/>
				}
			>
				<View style={styles.statRow}>
					<StatCard
						value={peerCount}
						label="Peers Nearby"
						color={peerCount > 0 ? '#2E7D32' : '#546E7A'}
						subtitle={isMeshActive ? 'Mesh active' : 'Mesh inactive'}
						onPress={() => {
							console.log('PEER CARD TAPPED')
							navigation.navigate('SignalMonitor')
						}}
					/>
					<StatCard
						value={queueDepth}
						label="Messages Queued"
						color={queueDepth > 0 ? '#E65100' : '#546E7A'}
						subtitle={isOnline ? 'Online — will sync' : 'Offline'}
					/>
				</View>

				<TouchableOpacity
					style={[styles.scanButton, isScanningPeers && styles.scanButtonDisabled]}
					onPress={handleScanPeers}
					disabled={isScanningPeers}
				>
					<Text style={styles.scanButtonText}>
						{isScanningPeers
							? 'Scanning nearby devices...'
							: isMeshActive
								? 'Scan Nearby Devices'
								: 'Start Mesh & Scan Devices'}
					</Text>
				</TouchableOpacity>

				<View style={styles.syncCard}>
					<Text style={styles.syncTitle}>Sync Status</Text>
					<View style={styles.syncTopRow}>
						<Text style={styles.syncMetaText}>Last sync: {formatTimestamp(lastSyncAt)}</Text>
						{isSyncing ? (
							<ActivityIndicator size="small" color="#1A237E" />
						) : (
							<Text style={[styles.syncMetaText, lastSyncAt ? styles.syncedText : styles.notSyncedText]}>
								{lastSyncAt ? '✓ Up to date' : 'Not synced yet'}
							</Text>
						)}
					</View>
					<View style={styles.syncBottomRow}>
						<Text style={styles.syncMetaText}>Internet: </Text>
						<Text style={[styles.syncMetaText, isOnline ? styles.syncedText : styles.offlineText]}>
							{isOnline ? 'Connected ✓' : 'Offline ✗'}
						</Text>
					</View>
					<TouchableOpacity
						style={[styles.syncNowButton, (!isOnline || isSyncing) && styles.syncNowButtonDisabled]}
						onPress={handleManualSync}
						disabled={!isOnline || isSyncing}
					>
						<Text style={styles.syncNowButtonText}>{isSyncing ? 'Syncing...' : 'Sync now'}</Text>
					</TouchableOpacity>
					{syncFeedback ? <Text style={styles.syncFeedbackText}>{syncFeedback}</Text> : null}
				</View>

				<View style={styles.triageRow}>
					{tierBadges.map(({ tier, count }) => {
						const color = PRIORITY_COLORS[tier]
						return (
							<View
								key={tier}
								style={[
									styles.tierBadge,
									{ backgroundColor: getBadgeBackground(color), borderColor: color },
								]}
							>
								<Text style={[styles.tierBadgeCount, { color }]}>{count}</Text>
								<Text style={[styles.tierBadgeLabel, { color }]}>{tier}</Text>
							</View>
						)
					})}
				</View>

				<View style={styles.messageSection}>
					<Text style={styles.messageSectionTitle}>Message Queue</Text>

					<View style={styles.tabBar}>
						<TouchableOpacity
							style={[styles.tabButton, activeTab === 'all' && styles.activeTabButton]}
							onPress={() => setActiveTab('all')}
						>
							<Text style={[styles.tabText, activeTab === 'all' && styles.activeTabText]}>
								All ({allMessages.length})
							</Text>
						</TouchableOpacity>

						<TouchableOpacity
							style={[styles.tabButton, activeTab === 'unsynced' && styles.activeTabButton]}
							onPress={() => setActiveTab('unsynced')}
						>
							<Text style={[styles.tabText, activeTab === 'unsynced' && styles.activeTabText]}>
								Unsynced ({unsyncedMessages.length})
							</Text>
						</TouchableOpacity>

						<TouchableOpacity
							style={[styles.tabButton, activeTab === 'critical' && styles.activeTabButton]}
							onPress={() => setActiveTab('critical')}
						>
							<Text style={[styles.tabText, activeTab === 'critical' && styles.activeTabText]}>
								Critical ({critical.length})
							</Text>
						</TouchableOpacity>
					</View>

					{displayedMessages.length === 0 ? (
						<View style={styles.emptyState}>
							<Text style={styles.emptyIcon}>📭</Text>
							<Text style={styles.emptyTitle}>No messages in this view</Text>
							<Text style={styles.emptySubtitle}>Send an SOS or wait for mesh messages</Text>
						</View>
					) : (
						displayedMessages.map((message) => (
							<View key={message.message_id} style={styles.messageCardWrap}>
								<MessageCard message={message} />
							</View>
						))
					)}
				</View>
			</ScrollView>
		</SafeAreaView>
	)
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: '#F5F5F5',
	},
	header: {
		backgroundColor: '#1A237E',
		padding: 16,
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
	},
	headerTitle: {
		color: '#FFFFFF',
		fontSize: 22,
		fontWeight: '700',
	},
	headerSubtitle: {
		color: '#B0BEC5',
		fontSize: 13,
		marginTop: 2,
	},
	headerStatusWrap: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
	},
	headerStatusDot: {
		fontSize: 14,
	},
	headerStatusText: {
		color: '#FFFFFF',
		fontSize: 13,
		fontWeight: '600',
	},
	contentContainer: {
		padding: 16,
		paddingBottom: 28,
	},
	cardShadow: {
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.08,
		shadowRadius: 4,
		elevation: 3,
	},
	statRow: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		marginBottom: 12,
	},
	scanButton: {
		backgroundColor: '#1565C0',
		borderRadius: 10,
		paddingVertical: 12,
		paddingHorizontal: 14,
		alignItems: 'center',
		justifyContent: 'center',
		marginBottom: 12,
	},
	scanButtonDisabled: {
		opacity: 0.6,
	},
	scanButtonText: {
		color: '#FFFFFF',
		fontSize: 14,
		fontWeight: '700',
	},
	statCard: {
		width: '48%',
		backgroundColor: '#FFFFFF',
		borderRadius: 12,
		padding: 16,
		...{
			shadowColor: '#000',
			shadowOffset: { width: 0, height: 2 },
			shadowOpacity: 0.08,
			shadowRadius: 4,
			elevation: 3,
		},
	},
	statCardTouchable: {
		justifyContent: 'flex-start',
	},
	statCardPressed: {
		opacity: 0.9,
	},
	statValue: {
		fontSize: 28,
		fontWeight: '700',
		lineHeight: 32,
	},
	statLabel: {
		fontSize: 13,
		color: '#666666',
		marginTop: 4,
	},
	statSubtitle: {
		fontSize: 11,
		color: '#999999',
		fontStyle: 'italic',
		marginTop: 4,
	},
	syncCard: {
		backgroundColor: '#FFFFFF',
		borderRadius: 12,
		padding: 16,
		marginBottom: 12,
		...{
			shadowColor: '#000',
			shadowOffset: { width: 0, height: 2 },
			shadowOpacity: 0.08,
			shadowRadius: 4,
			elevation: 3,
		},
	},
	syncTitle: {
		fontSize: 17,
		fontWeight: '700',
		color: '#1A237E',
		marginBottom: 10,
	},
	syncTopRow: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		marginBottom: 8,
	},
	syncBottomRow: {
		flexDirection: 'row',
		alignItems: 'center',
	},
	syncNowButton: {
		marginTop: 10,
		backgroundColor: '#1A237E',
		borderRadius: 8,
		paddingVertical: 10,
		alignItems: 'center',
	},
	syncNowButtonDisabled: {
		opacity: 0.6,
	},
	syncNowButtonText: {
		fontSize: 13,
		fontWeight: '700',
		color: '#FFFFFF',
	},
	syncFeedbackText: {
		marginTop: 8,
		fontSize: 12,
		color: '#616161',
	},
	syncMetaText: {
		fontSize: 13,
		color: '#616161',
	},
	syncedText: {
		color: '#2E7D32',
	},
	queuedText: {
		color: '#E65100',
	},
	offlineText: {
		color: '#C62828',
	},
	notSyncedText: {
		color: '#757575',
	},
	triageRow: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		marginBottom: 16,
	},
	tierBadge: {
		flex: 1,
		borderWidth: 1,
		borderRadius: 10,
		paddingVertical: 10,
		alignItems: 'center',
		marginRight: 8,
	},
	tierBadgeCount: {
		fontSize: 16,
		fontWeight: '700',
		lineHeight: 18,
	},
	tierBadgeLabel: {
		fontSize: 11,
		fontWeight: '600',
		marginTop: 4,
	},
	messageSection: {
		marginTop: 4,
	},
	messageSectionTitle: {
		fontSize: 18,
		fontWeight: '700',
		color: '#212121',
		marginBottom: 10,
	},
	tabBar: {
		flexDirection: 'row',
		marginBottom: 12,
		borderBottomWidth: 1,
		borderBottomColor: '#E0E0E0',
	},
	tabButton: {
		paddingVertical: 10,
		marginRight: 18,
		borderBottomWidth: 2,
		borderBottomColor: 'transparent',
	},
	activeTabButton: {
		borderBottomColor: '#C62828',
	},
	tabText: {
		fontSize: 13,
		color: '#757575',
		fontWeight: '400',
	},
	activeTabText: {
		fontWeight: '700',
		color: '#212121',
	},
	emptyState: {
		alignItems: 'center',
		justifyContent: 'center',
		paddingVertical: 36,
	},
	emptyIcon: {
		fontSize: 28,
		marginBottom: 8,
	},
	emptyTitle: {
		fontSize: 15,
		fontWeight: '600',
		color: '#424242',
	},
	emptySubtitle: {
		fontSize: 12,
		color: '#757575',
		marginTop: 4,
	},
	messageCardWrap: {
		marginBottom: 8,
	},
	messageCard: {
		backgroundColor: '#FFFFFF',
		borderRadius: 10,
		padding: 12,
		borderLeftWidth: 4,
		...{
			shadowColor: '#000',
			shadowOffset: { width: 0, height: 2 },
			shadowOpacity: 0.08,
			shadowRadius: 4,
			elevation: 3,
		},
	},
	messageTopRow: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
	},
	priorityWrap: {
		flexDirection: 'row',
		alignItems: 'center',
		flex: 1,
		paddingRight: 8,
	},
	priorityEmoji: {
		fontSize: 13,
		marginRight: 6,
	},
	priorityLabel: {
		fontSize: 12,
		fontWeight: '700',
	},
	messageBody: {
		fontSize: 14,
		color: '#333333',
		marginTop: 6,
	},
	messageBottomRow: {
		marginTop: 8,
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
	},
	messageBottomRight: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
	},
	messageMetaText: {
		fontSize: 11,
		color: '#757575',
	},
})

export default MeshStatusScreen
