// @ts-nocheck
import NetInfo from '@react-native-community/netinfo'
import supabase from '../lib/supabase'
import useMeshStore from '../store/meshStore'
import { startTelemetryReporter, stopTelemetryReporter, __telemetryReporterTestUtils } from './telemetryReporter'
import { getDeviceId } from '../device/identity'

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(),
    fetch: jest.fn(),
  },
}))

jest.mock('../lib/supabase', () => ({
  __esModule: true,
  default: {
    from: jest.fn(),
  },
}))

jest.mock('../device/identity', () => ({
  __esModule: true,
  getDeviceId: jest.fn(),
}))

describe('telemetryReporter', () => {
  const unsubscribeMock = jest.fn()
  const upsertMock = jest.fn()

  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()

    ;(NetInfo.addEventListener as jest.Mock).mockReturnValue(unsubscribeMock)
    ;(NetInfo.fetch as jest.Mock).mockResolvedValue({
      isConnected: true,
      isInternetReachable: true,
    })

    ;(supabase.from as jest.Mock).mockReturnValue({ upsert: upsertMock })
    ;(getDeviceId as jest.Mock).mockResolvedValue('device-1')

    useMeshStore.setState({
      myMascot: 'fox',
      currentPeers: [{ id: 'peer-1', transport: 'BLE' }],
      relayedCount: 3,
    })

    upsertMock.mockResolvedValue({ data: null, error: null })
  })

  afterEach(() => {
    stopTelemetryReporter()
    jest.useRealTimers()
  })

  it('pushTelemetry upserts expected shape when online', async () => {
    await __telemetryReporterTestUtils.pushTelemetry()

    expect(supabase.from).toHaveBeenCalledWith('mesh_telemetry')
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        device_id: 'device-1',
        mascot: 'fox',
        role: 'gateway',
        peer_ids: ['peer-1'],
        hop_count: 3,
        conn_type: 'bluetooth',
        is_origin: false,
      }),
      { onConflict: 'device_id' }
    )
  })

  it('pushTelemetry handles supabase error without throwing', async () => {
    upsertMock.mockResolvedValue({
      data: null,
      error: { message: 'write failed' },
    })

    await expect(__telemetryReporterTestUtils.pushTelemetry()).resolves.toBeUndefined()
  })

  it('stopTelemetryReporter clears intervals and unsubscribes', () => {
    startTelemetryReporter()
    stopTelemetryReporter()

    expect(unsubscribeMock).toHaveBeenCalled()
  })
})
