module.exports = ({ config }) => {
  const apiBaseUrl =
    process.env.EXPO_PUBLIC_API_BASE_URL ??
    process.env.API_BASE_URL ??
    undefined

  return {
    ...config,
    plugins: [...(config?.plugins ?? []), 'expo-asset'],
    android: {
      ...(config?.android ?? {}),
      usesCleartextTraffic: true,
    },
    extra: {
      ...(config?.extra ?? {}),
      apiBaseUrl,
    },
  }
}