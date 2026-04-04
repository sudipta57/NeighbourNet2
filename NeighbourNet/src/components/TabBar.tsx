import React from 'react'
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

interface TabBarProps {
  activeTab: 'sos' | 'mesh' | 'friends' | 'profile'
  onTabChange: (tab: 'sos' | 'mesh' | 'friends' | 'profile') => void
  criticalCount: number
}

const TabBar = ({ activeTab, onTabChange, criticalCount }: TabBarProps) => {
  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.tabButton} onPress={() => onTabChange('sos')} activeOpacity={0.8}>
        <View style={styles.iconWrap}>
          <Text style={[styles.icon, activeTab === 'sos' ? styles.sosActive : styles.inactive]}>🆘</Text>
          {criticalCount > 0 ? (
            <View style={styles.criticalBadge}>
              <Text style={styles.badgeText}>{criticalCount}</Text>
            </View>
          ) : null}
        </View>
        <Text
          style={[
            styles.label,
            activeTab === 'sos' ? styles.sosActive : styles.inactive,
            activeTab === 'sos' ? styles.bold : null,
          ]}
        >
          SOS
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.tabButton} onPress={() => onTabChange('mesh')} activeOpacity={0.8}>
        <View style={styles.iconWrap}>
          <Text style={[styles.icon, activeTab === 'mesh' ? styles.meshActive : styles.inactive]}>📡</Text>
        </View>
        <Text
          style={[
            styles.label,
            activeTab === 'mesh' ? styles.meshActive : styles.inactive,
            activeTab === 'mesh' ? styles.bold : null,
          ]}
        >
          Mesh
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.tabButton} onPress={() => onTabChange('friends')} activeOpacity={0.8}>
        <View style={styles.iconWrap}>
          <Text style={[styles.icon, activeTab === 'friends' ? styles.friendsActive : styles.inactive]}>👥</Text>
        </View>
        <Text
          style={[
            styles.label,
            activeTab === 'friends' ? styles.friendsActive : styles.inactive,
            activeTab === 'friends' ? styles.bold : null,
          ]}
        >
          Friends
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.tabButton} onPress={() => onTabChange('profile')} activeOpacity={0.8}>
        <View style={styles.iconWrap}>
          <Text style={[styles.icon, activeTab === 'profile' ? styles.profileActive : styles.inactive]}>👤</Text>
        </View>
        <Text
          style={[
            styles.label,
            activeTab === 'profile' ? styles.profileActive : styles.inactive,
            activeTab === 'profile' ? styles.bold : null,
          ]}
        >
          Profile
        </Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    height: 60,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: Platform.OS === 'ios' ? 0.1 : 0,
    shadowRadius: Platform.OS === 'ios' ? 4 : 0,
    elevation: 8,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    position: 'relative',
  },
  icon: {
    fontSize: 24,
  },
  label: {
    marginTop: 2,
    fontSize: 12,
  },
  sosActive: {
    color: '#C62828',
  },
  meshActive: {
    color: '#00897B',
  },
  friendsActive: {
    color: '#1A237E',
  },
  profileActive: {
    color: '#283593',
  },
  inactive: {
    color: '#9E9E9E',
  },
  bold: {
    fontWeight: '700',
  },
  criticalBadge: {
    position: 'absolute',
    top: -6,
    right: -12,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#C62828',
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
})

export default TabBar
