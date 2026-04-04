import { create } from 'zustand'

export type PeerTransport = 'BLE' | 'WIFI_DIRECT'

export type MeshPeer = {
  id: string
  transport: PeerTransport
  rssi?: number
}

type MeshStoreState = {
  myMascot: string | null
  currentPeers: MeshPeer[]
  relayedCount: number
  setMyMascot: (mascot: string | null) => void
  setPeers: (peers: MeshPeer[]) => void
  incrementRelayed: () => void
  resetRelayedCount: () => void
}

const useMeshStore = create<MeshStoreState>()((set) => ({
  myMascot: null,
  currentPeers: [],
  relayedCount: 0,

  setMyMascot: (mascot) => set({ myMascot: mascot }),

  setPeers: (peers) => {
    const uniquePeers = peers.filter(
      (peer, index, source) =>
        source.findIndex((candidate) => candidate.id === peer.id) === index
    )
    set({ currentPeers: uniquePeers })
  },

  incrementRelayed: () => set((state) => ({ relayedCount: state.relayedCount + 1 })),

  resetRelayedCount: () => set({ relayedCount: 0 }),
}))

export default useMeshStore
