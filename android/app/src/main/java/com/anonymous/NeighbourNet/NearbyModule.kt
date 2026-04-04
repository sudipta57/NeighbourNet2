package com.anonymous.NeighbourNet

import android.os.Build
import android.provider.Settings
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
import com.google.android.gms.nearby.connection.ConnectionInfo
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.ConnectionsClient
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo
import com.google.android.gms.nearby.connection.DiscoveryOptions
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy
import java.nio.charset.Charset
import java.util.Collections

class NearbyModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

  private val connectionsClient: ConnectionsClient = Nearby.getConnectionsClient(reactContext)
  private val connectedEndpoints = Collections.synchronizedSet(mutableSetOf<String>())
  private val endpointName = buildEndpointName(reactContext)
  private val serviceId = reactContext.packageName
  private val strategy = Strategy.P2P_CLUSTER
  @Volatile private var meshRunning = false

  private val payloadCallback = object : PayloadCallback() {
    override fun onPayloadReceived(endpointId: String, payload: Payload) {
      val bytes = payload.asBytes()
      if (bytes == null) {
        return
      }

      val message = String(bytes, Charset.forName("UTF-8"))
      Log.d("NearbyMesh", "NearbyMesh: message received from $endpointId")
      emitEvent(
        "onMessageReceived",
        Arguments.createMap().apply {
          putString("message", message)
        }
      )
    }

    override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {
      // No-op.
    }
  }

  private val connectionLifecycleCallback = object : ConnectionLifecycleCallback() {
    override fun onConnectionInitiated(endpointId: String, connectionInfo: ConnectionInfo) {
      Log.i("NearbyMesh", "NearbyMesh: connection initiated with $endpointId")
      connectionsClient.acceptConnection(endpointId, payloadCallback)
    }

    override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
      if (result.status.statusCode == ConnectionsStatusCodes.STATUS_OK) {
        val peerCount = synchronized(connectedEndpoints) {
          connectedEndpoints.add(endpointId)
          connectedEndpoints.size
        }
        Log.i("NearbyMesh", "NearbyMesh: peer connected — total peers: $peerCount")
        emitPeerEvent("onPeerConnected", endpointId, peerCount)
      } else {
        Log.w("NearbyMesh", "NearbyMesh: connection failed for $endpointId with ${result.status.statusCode}")
      }
    }

    override fun onDisconnected(endpointId: String) {
      val peerCount = synchronized(connectedEndpoints) {
        connectedEndpoints.remove(endpointId)
        connectedEndpoints.size
      }
      Log.i("NearbyMesh", "NearbyMesh: peer disconnected — total peers: $peerCount")
      emitPeerEvent("onPeerDisconnected", endpointId, peerCount)
    }
  }

  private val discoveryCallback = object : EndpointDiscoveryCallback() {
    override fun onEndpointFound(endpointId: String, discoveryInfo: DiscoveredEndpointInfo) {
      Log.i("NearbyMesh", "NearbyMesh: endpoint found: $endpointId")

      // Prevent both devices from racing requestConnection at once.
      val remoteEndpointName = discoveryInfo.endpointName
      val shouldInitiate = endpointName <= remoteEndpointName
      if (!shouldInitiate) {
        Log.i("NearbyMesh", "NearbyMesh: waiting for remote initiator $remoteEndpointName")
        return
      }

      Log.i("NearbyMesh", "NearbyMesh: requesting connection to $endpointId")
      connectionsClient
        .requestConnection(endpointName, endpointId, connectionLifecycleCallback)
        .addOnFailureListener { error ->
          val apiException = error as? ApiException
          val statusCode = apiException?.statusCode
          Log.w("NearbyMesh", "NearbyMesh: requestConnection failed for $endpointId with status=$statusCode", error)

          if (statusCode == ConnectionsStatusCodes.STATUS_RADIO_ERROR) {
            Log.w("NearbyMesh", "NearbyMesh: radio error during requestConnection, will retry on next scan")
          }

          if (statusCode == ConnectionsStatusCodes.STATUS_ALREADY_CONNECTED_TO_ENDPOINT) {
            val peerCount = synchronized(connectedEndpoints) {
              connectedEndpoints.add(endpointId)
              connectedEndpoints.size
            }
            emitPeerEvent("onPeerConnected", endpointId, peerCount)
          }
        }
    }

    override fun onEndpointLost(endpointId: String) {
      Log.i("NearbyMesh", "NearbyMesh: endpoint lost: $endpointId")
    }
  }

  override fun getName() = "NearbyMesh"

  private fun startDiscovery(promise: Promise?) {
    connectionsClient
      .startDiscovery(
        serviceId,
        discoveryCallback,
        DiscoveryOptions.Builder().setStrategy(strategy).build()
      )
      .addOnSuccessListener {
        Log.i("NearbyMesh", "NearbyMesh: discovery started")
        meshRunning = true
        promise?.resolve(null)
      }
      .addOnFailureListener { error ->
        val apiException = error as? ApiException
        if (apiException?.statusCode == ConnectionsStatusCodes.STATUS_ALREADY_DISCOVERING) {
          Log.i("NearbyMesh", "NearbyMesh: discovery already running")
          meshRunning = true
          promise?.resolve(null)
          return@addOnFailureListener
        }
        Log.e("NearbyMesh", "NearbyMesh: discovery failed", error)
        promise?.reject("DISCOVERY_FAILED", error)
      }
  }

  private fun startAdvertisingThenDiscovery(promise: Promise?) {
    connectionsClient
      .startAdvertising(
        endpointName,
        serviceId,
        connectionLifecycleCallback,
        AdvertisingOptions.Builder().setStrategy(strategy).build()
      )
      .addOnSuccessListener {
        Log.i("NearbyMesh", "NearbyMesh: advertising started")
        startDiscovery(promise)
      }
      .addOnFailureListener { error ->
        val apiException = error as? ApiException
        if (apiException?.statusCode == ConnectionsStatusCodes.STATUS_ALREADY_ADVERTISING) {
          Log.i("NearbyMesh", "NearbyMesh: advertising already running")
          startDiscovery(promise)
          return@addOnFailureListener
        }

        Log.e("NearbyMesh", "NearbyMesh: advertising failed", error)
        promise?.reject("ADVERTISING_FAILED", error)
      }
  }

  @ReactMethod
  fun startMesh(promise: Promise) {
    Log.i("NearbyMesh", "NearbyMesh: startMesh invoked")

    if (meshRunning) {
      scanNow(promise)
      return
    }

    connectionsClient.stopAllEndpoints()
    startAdvertisingThenDiscovery(promise)
  }

  @ReactMethod
  fun scanNow(promise: Promise) {
    Log.i("NearbyMesh", "NearbyMesh: scanNow invoked")

    if (!meshRunning) {
      startMesh(promise)
      return
    }

    connectionsClient.stopDiscovery()
    Log.i("NearbyMesh", "NearbyMesh: scanNow invoked, restarting discovery")
    startAdvertisingThenDiscovery(promise)
  }

  @ReactMethod
  fun stopMesh(promise: Promise) {
    connectionsClient.stopDiscovery()
    connectionsClient.stopAdvertising()
    connectionsClient.stopAllEndpoints()
    synchronized(connectedEndpoints) {
      connectedEndpoints.clear()
    }
    meshRunning = false
    Log.i("NearbyMesh", "NearbyMesh: mesh stopped")
    promise.resolve(null)
  }

  @ReactMethod
  fun sendMessage(messageJson: String, promise: Promise) {
    val endpointIds = synchronized(connectedEndpoints) { connectedEndpoints.toList() }
    if (endpointIds.isEmpty()) {
      Log.d("NearbyMesh", "NearbyMesh: sendMessage called with no peers")
      promise.resolve(0)
      return
    }

    Log.d("NearbyMesh", "NearbyMesh: sendMessage called")
    connectionsClient.sendPayload(endpointIds, Payload.fromBytes(messageJson.toByteArray(Charsets.UTF_8)))
    promise.resolve(endpointIds.size)
  }

  @ReactMethod
  fun getConnectedPeerCount(promise: Promise) {
    val peerCount = synchronized(connectedEndpoints) { connectedEndpoints.size }
    promise.resolve(peerCount)
  }

  @ReactMethod
  fun addListener(eventName: String?) {
    // Required by React Native NativeEventEmitter.
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // Required by React Native NativeEventEmitter.
  }

  private fun emitPeerEvent(eventName: String, endpointId: String, peerCount: Int) {
    emitEvent(
      eventName,
      Arguments.createMap().apply {
        putString("endpointId", endpointId)
        putInt("peerCount", peerCount)
      }
    )
  }

  private fun emitEvent(eventName: String, params: com.facebook.react.bridge.WritableMap) {
    val reactContext: ReactContext = reactApplicationContext
    if (reactContext.hasActiveReactInstance()) {
      reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(eventName, params)
    }
  }

  private fun buildEndpointName(reactContext: ReactApplicationContext): String {
    val model = Build.MODEL?.takeIf { it.isNotBlank() } ?: "NeighbourNet"
    val androidId = Settings.Secure.getString(reactContext.contentResolver, Settings.Secure.ANDROID_ID)
      ?.takeLast(6)
      ?: "device"
    return "$model-$androidId"
  }
}
