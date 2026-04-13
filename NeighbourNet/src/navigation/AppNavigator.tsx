import React from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator, NativeStackScreenProps } from '@react-navigation/native-stack'
import MeshStatusScreen from '../screens/MeshStatusScreen'
import SignalMonitorScreen from '../screens/SignalMonitorScreen'
import FriendMapScreen from '../screens/FriendMapScreen'

export type MeshStackParamList = {
  MeshStatus: undefined
  SignalMonitor: undefined
  FriendMap: undefined
}

const Stack = createNativeStackNavigator<MeshStackParamList>()

const FriendMapStackScreen = ({ navigation }: NativeStackScreenProps<MeshStackParamList, 'FriendMap'>) => {
  return <FriendMapScreen onBack={() => navigation.goBack()} />
}

const AppNavigator = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator
        id="MeshStack"
        initialRouteName="MeshStatus"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#1a2340' },
        }}
      >
        <Stack.Screen name="MeshStatus" component={MeshStatusScreen} />
        <Stack.Screen name="SignalMonitor" component={SignalMonitorScreen} />
        <Stack.Screen name="FriendMap" component={FriendMapStackScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}

export default AppNavigator
