import React, { useEffect, useRef, useState } from 'react'
import {
	ActivityIndicator,
	Alert,
	Animated,
	Dimensions,
	Linking,
	Platform,
	SafeAreaView,
	ScrollView,
	StatusBar,
	StyleSheet,
	Text,
	TouchableOpacity,
	View,
} from 'react-native'
import * as Location from 'expo-location'
import { getDeviceId } from '../db/database'
import useAppStore from '../store/useAppStore'

const { width: SCREEN_WIDTH } = Dimensions.get('window')

const SLIDES = [
	{
		id: '1',
		icon: '🌊',
		title: 'Built for Bengal\'s Floods',
		titleBn: 'বাংলার বন্যার জন্য তৈরি',
		body:
			'When Cyclone Amphan struck in 2020, over 1,000 cell towers failed in 24 hours. ' +
			'2.9 million people were displaced with no way to call for help.',
		bodyBn: 'যখন সাইক্লোন আমফান আঘাত হানে, ২.৯ মিলিয়ন মানুষ সাহায্যের জন্য যোগাযোগ করতে পারেননি।',
		color: '#1A237E',
	},
	{
		id: '2',
		icon: '📡',
		title: 'No Internet? No Problem.',
		titleBn: 'ইন্টারনেট নেই? কোনো সমস্যা নেই।',
		body:
			'NeighbourNet turns every phone into a mesh node. ' +
			'Your SOS hops from phone to phone using Bluetooth and WiFi Direct — ' +
			'no towers, no internet, no special hardware needed.',
		bodyBn: 'আপনার SOS ব্লুটুথ ও WiFi Direct দিয়ে ফোন থেকে ফোনে পৌঁছায় — ' + 'কোনো টাওয়ার বা ইন্টারনেট ছাড়াই।',
		color: '#1565C0',
	},
	{
		id: '3',
		icon: '🤖',
		title: 'AI Triage — Fully Offline',
		titleBn: 'AI অগ্রাধিকার — সম্পূর্ণ অফলাইন',
		body:
			'Every message is scored CRITICAL, HIGH, MEDIUM, or LOW by an AI model ' +
			'running entirely on your phone. No data leaves your device until you choose to sync.',
		bodyBn:
			'প্রতিটি বার্তা আপনার ফোনেই AI দিয়ে বিশ্লেষণ করা হয়। ' +
			'আপনি sync না করা পর্যন্ত কোনো তথ্য ডিভাইস ছাড়ে না।',
		color: '#283593',
	},
	{
		id: '4',
		icon: '🚣',
		title: 'Relay Runner Protocol',
		titleBn: 'রিলে রানার প্রোটোকল',
		body:
			'If two groups are physically separated by floodwater with no phones in between, ' +
			'one person can physically walk between zones carrying messages on their phone. ' +
			'This is the relay runner — the human bridge of last resort.',
		bodyBn:
			'যদি দুটি দল বন্যার জলে আলাদা হয়ে যায়, একজন মানুষ ফোন নিয়ে ' +
			'দুই দলের মাঝে হেঁটে বার্তা পৌঁছে দিতে পারেন।',
		color: '#1A237E',
	},
	{
		id: '5',
		icon: '🔋',
		title: 'Permissions & Battery',
		titleBn: 'অনুমতি ও ব্যাটারি',
		body:
			'NeighbourNet needs Location and Bluetooth permissions to work. ' +
			'We also need battery optimisation to be disabled so the mesh ' +
			'keeps running when your screen is off.',
		bodyBn:
			'NeighbourNet-এর Location ও Bluetooth অনুমতি দরকার। ' +
			'স্ক্রিন বন্ধ থাকলেও mesh চালু রাখতে ব্যাটারি অপটিমাইজেশন বন্ধ রাখুন।',
		color: '#283593',
		isPermissionSlide: true,
	},
]

interface OnboardingScreenProps {
	onComplete: () => void
}

const OnboardingScreen = ({ onComplete }: OnboardingScreenProps) => {
	const [currentSlide, setCurrentSlide] = useState(0)
	const [locationGranted, setLocationGranted] = useState(false)
	const [btPermissionAsked, setBtPermissionAsked] = useState(false)
	const [batteryOptAsked, setBatteryOptAsked] = useState(false)
	const [isInitializing, setIsInitializing] = useState(true)

	const scrollRef = useRef<ScrollView>(null)
	const dotWidths = useRef(
		SLIDES.map((_, index) => new Animated.Value(index === 0 ? 20 : 8))
	).current

	const setDeviceId = useAppStore((state) => state.setDeviceId)

	useEffect(() => {
		const initialize = async () => {
			try {
				const deviceId = await getDeviceId()
				setDeviceId(deviceId)
			} catch {
				onComplete()
			} finally {
				setIsInitializing(false)
			}
		}

		initialize()
	}, [onComplete, setDeviceId])

	useEffect(() => {
		dotWidths.forEach((dot, index) => {
			Animated.timing(dot, {
				toValue: index === currentSlide ? 20 : 8,
				duration: 180,
				useNativeDriver: false,
			}).start()
		})
	}, [currentSlide, dotWidths])

	const handleNext = () => {
		if (currentSlide < SLIDES.length - 1) {
			const nextSlide = currentSlide + 1
			setCurrentSlide(nextSlide)
			scrollRef.current?.scrollTo({
				x: nextSlide * SCREEN_WIDTH,
				animated: true,
			})
			return
		}

		handleComplete()
	}

	const handleBack = () => {
		if (currentSlide > 0) {
			const prevSlide = currentSlide - 1
			setCurrentSlide(prevSlide)
			scrollRef.current?.scrollTo({
				x: prevSlide * SCREEN_WIDTH,
				animated: true,
			})
		}
	}

	const handleComplete = () => {
		onComplete()
	}

	const handleRequestLocation = async () => {
		setBtPermissionAsked(true)

		const { status } = await Location.requestForegroundPermissionsAsync()
		if (status === 'granted') {
			setLocationGranted(true)
			Alert.alert('Location granted ✓', 'GPS will be attached to your SOS messages.')
			return
		}

		Alert.alert(
			'Location Denied',
			'You can enable it later in Settings. Your messages will be sent without GPS.'
		)
	}

	const handleBatteryOptimisation = () => {
		setBatteryOptAsked(true)

		if (Platform.OS === 'android') {
			Alert.alert(
				'Battery Optimisation',
				"In the next screen, find NeighbourNet and select 'Don't optimise' or 'Unrestricted'. This keeps the mesh running when screen is off.",
				[
					{
						text: 'Open Settings',
						onPress: () => {
							Linking.openSettings()
						},
					},
					{ text: 'Skip for now', style: 'cancel' },
				]
			)
			return
		}

		Alert.alert('Battery Optimisation', 'Battery optimisation settings are only available on Android.')
	}

	const handleScrollEnd = (event: { nativeEvent: { contentOffset: { x: number } } }) => {
		const slideIndex = Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH)
		setCurrentSlide(slideIndex)
	}

	const currentSlideColor = SLIDES[currentSlide].color

	if (isInitializing) {
		return (
			<View style={styles.loadingContainer}>
				<ActivityIndicator size="large" color="#1A237E" />
			</View>
		)
	}

	return (
		<SafeAreaView style={[styles.container, { backgroundColor: currentSlideColor }]}>
			<StatusBar barStyle="light-content" backgroundColor={currentSlideColor} />

			{currentSlide < SLIDES.length - 1 && (
				<TouchableOpacity style={styles.skipButton} onPress={handleComplete}>
					<Text style={styles.skipText}>Skip</Text>
				</TouchableOpacity>
			)}

			<ScrollView
				ref={scrollRef}
				horizontal
				pagingEnabled
				showsHorizontalScrollIndicator={false}
				scrollEnabled={false}
				onMomentumScrollEnd={handleScrollEnd}
			>
				{SLIDES.map((slide) => {
					const isPermissionSlide = Boolean(slide.isPermissionSlide)

					return (
						<View key={slide.id} style={styles.slide}>
							<Text style={styles.icon}>{slide.icon}</Text>
							<Text style={styles.title}>{slide.title}</Text>
							<Text style={styles.titleBn}>{slide.titleBn}</Text>

							<Text style={styles.body}>{slide.body}</Text>
							<Text style={styles.bodyBn}>{slide.bodyBn}</Text>

							{isPermissionSlide && (
								<View style={styles.permissionsContainer}>
									<TouchableOpacity
										style={locationGranted ? styles.permissionButtonDone : styles.permissionButton}
										onPress={handleRequestLocation}
										disabled={locationGranted}
									>
										<Text style={locationGranted ? styles.permissionTextDone : styles.permissionText}>
											{locationGranted ? '📍 Location Granted ✓' : '📍 Grant Location Permission'}
										</Text>
									</TouchableOpacity>

									<TouchableOpacity
										style={batteryOptAsked ? styles.permissionButtonDone : styles.permissionButton}
										onPress={handleBatteryOptimisation}
									>
										<Text style={batteryOptAsked ? styles.permissionTextDone : styles.permissionText}>
											{batteryOptAsked
												? '🔋 Battery Settings Opened ✓'
												: '🔋 Disable Battery Optimisation'}
										</Text>
									</TouchableOpacity>

									<Text style={styles.note}>You can change these in Settings at any time.</Text>
								</View>
							)}
						</View>
					)
				})}
			</ScrollView>

			<View style={styles.bottomBar}>
				<View style={styles.bottomLeft}>
					{currentSlide > 0 ? (
						<TouchableOpacity onPress={handleBack}>
							<Text style={styles.backText}>← Back</Text>
						</TouchableOpacity>
					) : null}
				</View>

				<View style={styles.dotsContainer}>
					{SLIDES.map((slide, index) => (
						<Animated.View
							key={slide.id}
							style={[
								styles.dot,
								index === currentSlide ? styles.dotActive : styles.dotInactive,
								{ width: dotWidths[index] },
							]}
						/>
					))}
				</View>

				<View style={styles.bottomRight}>
					<TouchableOpacity
						style={currentSlide === SLIDES.length - 1 ? styles.nextButtonFinal : styles.nextButton}
						onPress={handleNext}
					>
						<Text
							style={[
								styles.nextButtonText,
								currentSlide === SLIDES.length - 1
									? styles.nextButtonTextFinal
									: currentSlideColor === '#1565C0'
										? styles.nextButtonTextBlue
										: currentSlideColor === '#283593'
											? styles.nextButtonTextIndigo
											: styles.nextButtonTextNavy,
							]}
						>
							{currentSlide === SLIDES.length - 1 ? 'Start App →' : 'Next →'}
						</Text>
					</TouchableOpacity>
				</View>
			</View>
		</SafeAreaView>
	)
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	loadingContainer: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: '#FFFFFF',
	},
	skipButton: {
		position: 'absolute',
		top: 16,
		right: 16,
		zIndex: 2,
		paddingHorizontal: 8,
		paddingVertical: 4,
	},
	skipText: {
		color: '#FFFFFF',
		fontSize: 16,
		opacity: 0.7,
	},
	slide: {
		width: SCREEN_WIDTH,
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		paddingHorizontal: 32,
	},
	icon: {
		fontSize: 80,
		textAlign: 'center',
		marginBottom: 24,
	},
	title: {
		fontSize: 26,
		fontWeight: '700',
		color: '#FFFFFF',
		textAlign: 'center',
		marginBottom: 8,
	},
	titleBn: {
		fontSize: 18,
		color: '#FFFFFF',
		opacity: 0.85,
		textAlign: 'center',
		marginBottom: 24,
	},
	body: {
		fontSize: 15,
		lineHeight: 22,
		color: '#FFFFFF',
		opacity: 0.9,
		textAlign: 'center',
		marginBottom: 12,
	},
	bodyBn: {
		fontSize: 13,
		lineHeight: 20,
		color: '#FFFFFF',
		opacity: 0.75,
		textAlign: 'center',
		marginBottom: 32,
	},
	permissionsContainer: {
		width: '100%',
		alignItems: 'center',
	},
	permissionButton: {
		width: '100%',
		backgroundColor: '#FFFFFF',
		borderRadius: 12,
		padding: 14,
		marginBottom: 12,
	},
	permissionButtonDone: {
		width: '100%',
		backgroundColor: 'rgba(255,255,255,0.3)',
		borderRadius: 12,
		padding: 14,
		marginBottom: 12,
	},
	permissionText: {
		color: '#1A237E',
		fontSize: 15,
		fontWeight: '600',
		textAlign: 'center',
	},
	permissionTextDone: {
		color: '#FFFFFF',
		fontSize: 15,
		fontWeight: '600',
		textAlign: 'center',
	},
	note: {
		color: '#FFFFFF',
		fontSize: 12,
		opacity: 0.7,
		textAlign: 'center',
	},
	bottomBar: {
		backgroundColor: 'rgba(0,0,0,0.2)',
		padding: 20,
		flexDirection: 'row',
		alignItems: 'center',
	},
	bottomLeft: {
		minWidth: 70,
	},
	backText: {
		color: '#FFFFFF',
		opacity: 0.8,
		fontSize: 16,
	},
	dotsContainer: {
		flex: 1,
		flexDirection: 'row',
		justifyContent: 'center',
		alignItems: 'center',
	},
	dot: {
		height: 8,
		borderRadius: 4,
		marginHorizontal: 4,
		backgroundColor: '#FFFFFF',
	},
	dotActive: {
		opacity: 1,
	},
	dotInactive: {
		opacity: 0.4,
	},
	bottomRight: {
		minWidth: 120,
		alignItems: 'flex-end',
	},
	nextButton: {
		borderRadius: 20,
		paddingHorizontal: 20,
		paddingVertical: 10,
		backgroundColor: '#FFFFFF',
	},
	nextButtonFinal: {
		borderRadius: 20,
		paddingHorizontal: 20,
		paddingVertical: 10,
		backgroundColor: '#C62828',
	},
	nextButtonText: {
		fontSize: 15,
		fontWeight: '700',
	},
	nextButtonTextNavy: {
		color: '#1A237E',
	},
	nextButtonTextBlue: {
		color: '#1565C0',
	},
	nextButtonTextIndigo: {
		color: '#283593',
	},
	nextButtonTextFinal: {
		color: '#FFFFFF',
	},
})

export default OnboardingScreen
