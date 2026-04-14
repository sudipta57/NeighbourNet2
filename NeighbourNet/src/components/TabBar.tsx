import React from 'react'
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

interface TabBarProps {
  activeTab: 'sos' | 'mesh' | 'friends' | 'profile'
  onTabChange: (tab: 'sos' | 'mesh' | 'friends' | 'profile') => void
  criticalCount: number
}

const TabBar = ({ activeTab, onTabChange, criticalCount }: TabBarProps) => {
  const insets = useSafeAreaInsets()
  const paddingBottom = Platform.OS === 'ios' ? Math.max(20, insets.bottom) : Math.max(10, insets.bottom)
  const height = 55 + paddingBottom

  return (
    <View style={[styles.container, { paddingBottom, height }]}>
      <TouchableOpacity style={styles.tabButton} onPress={() => onTabChange('sos')} activeOpacity={0.8}>
        <View style={styles.iconWrap}>
          <MaterialCommunityIcons 
            name="alert-octagon-outline" 
            size={24} 
            color={activeTab === 'sos' ? '#182A6A' : '#8B99B8'} 
          />
          {criticalCount > 0 ? (
            <View style={styles.criticalBadge}>
              <Text style={styles.badgeText}>{criticalCount}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.label, activeTab === 'sos' ? styles.activeText : styles.inactiveText]}>
          SOS
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.tabButton} onPress={() => onTabChange('mesh')} activeOpacity={0.8}>
        <View style={[styles.iconWrap, activeTab === 'mesh' ? styles.activeIconBg : null]}>
          <MaterialCommunityIcons 
            name="webpack" 
            size={24} 
            color={activeTab === 'mesh' ? '#182A6A' : '#8B99B8'} 
          />
        </View>
        <Text style={[styles.label, activeTab === 'mesh' ? styles.activeText : styles.inactiveText]}>
          MESH
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.tabButton} onPress={() => onTabChange('friends')} activeOpacity={0.8}>
        <View style={styles.iconWrap}>
          <Ionicons 
            name="people-outline" 
            size={24} 
            color={activeTab === 'friends' ? '#182A6A' : '#8B99B8'} 
          />
        </View>
        <Text style={[styles.label, activeTab === 'friends' ? styles.activeText : styles.inactiveText]}>
          FRIENDS
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.tabButton} onPress={() => onTabChange('profile')} activeOpacity={0.8}>
        <View style={[styles.iconWrap, activeTab === 'profile' ? styles.activeIconBg : null]}>
          <Ionicons 
            name="person-outline" 
            size={22} 
            color={activeTab === 'profile' ? '#182A6A' : '#8B99B8'} 
          />
        </View>
        <Text style={[styles.label, activeTab === 'profile' ? styles.activeText : styles.inactiveText]}>
          PROFILE
        </Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#FAFCFF',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: '#E8EDF9',
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    paddingTop: 8,
  },
  iconWrap: {
    position: 'relative',
    padding: 6,
    borderRadius: 14,
    marginBottom: 4,
  },
  activeIconBg: {
    backgroundColor: '#E4ECFD',
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  activeText: {
    color: '#65789A',
  },
  inactiveText: {
    color: '#A0ADC9',
  },
  criticalBadge: {
    position: 'absolute',
    top: -2,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#E53935',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FAFCFF',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },
})

export default TabBar
