import AsyncStorage from '@react-native-async-storage/async-storage'

const ONBOARDING_KEY = 'neighbournet_onboarding_complete'

export async function isOnboardingComplete(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(ONBOARDING_KEY)
    return value === 'true'
  } catch {
    return false
  }
}

export async function markOnboardingComplete(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true')
  } catch (e) {
    console.error('Failed to save onboarding state:', e)
  }
}
