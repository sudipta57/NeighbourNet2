package com.anonymous.NeighbourNet

import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
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
import java.io.File
import java.io.FileOutputStream
import java.nio.charset.Charset
import java.util.Collections
import java.util.UUID

class NearbyModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val MAX_SEEN_IDS = 500
    private const val DEFAULT_TTL = 3
    private const val BYTE_IMAGE: Byte = 0x01
    private const val BYTE_PTT: Byte = 0x02
  }

  private val connectionsClient: ConnectionsClient = Nearby.getConnectionsClient(reactContext)
  private val connectedEndpoints = Collections.synchronizedSet(mutableSetOf<String>())
  // Maps Nearby endpoint ID → JS device UUID (populated as messages arrive)
  private val endpointToDeviceId = Collections.synchronizedMap(mutableMapOf<String, String>())
  private val endpointName = buildEndpointName(reactContext)
  private val serviceId = reactContext.packageName
  private val strategy = Strategy.P2P_CLUSTER
  @Volatile private var meshRunning = false

  private val deviceId: String = Settings.Secure.getString(
    reactContext.contentResolver, Settings.Secure.ANDROID_ID
  ) ?: "unknown"

  // Bounded dedup set: evicts oldest entry when full.
  private val seenMessageIds: MutableSet<String> = Collections.synchronizedSet(
    object : LinkedHashSet<String>() {
      override fun add(element: String): Boolean {
        if (size >= MAX_SEEN_IDS) remove(iterator().next())
        return super.add(element)
      }
    }
  )

  private val ttl = DEFAULT_TTL

  private val payloadCallback = object : PayloadCallback() {
    override fun onPayloadReceived(endpointId: String, payload: Payload) {
      val bytes = payload.asBytes() ?: return
      if (bytes.isEmpty()) return

      when {
        bytes[0] == BYTE_IMAGE -> handleBinaryPayload(bytes, endpointId, "image")
        bytes[0] == BYTE_PTT   -> handleBinaryPayload(bytes, endpointId, "ptt_audio")
        else                   -> handleTextPayload(bytes, endpointId)
      }
    }

    override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {
      // No-op.
    }
  }

  // ── Text message handling (unchanged from v1.0) ──────────────────────────

  private fun handleTextPayload(bytes: ByteArray, sourceEndpointId: String) {
    val messageJson = String(bytes, Charset.forName("UTF-8"))

    // Track endpoint → device UUID mapping
    try {
      val sid = org.json.JSONObject(messageJson).optString("sender_id", "")
      if (sid.isNotEmpty()) endpointToDeviceId[sourceEndpointId] = sid
    } catch (_: Exception) {}

    val msgType = try {
      org.json.JSONObject(messageJson).optString("message_type", "sos")
    } catch (e: Exception) { "sos" }

    if (msgType == "ack") {
      val ackDest = try {
        org.json.JSONObject(messageJson).optString("destination_id", "")
      } catch (e: Exception) { "" }
      if (ackDest == deviceId) {
        sendEventToJS("onMessageDelivered", messageJson)
      } else {
        rebroadcastToAll(messageJson, sourceEndpointId)
      }
      return
    }

    val messageId = try {
      org.json.JSONObject(messageJson).optString("message_id", "")
    } catch (e: Exception) { "" }

    if (messageId.isNotEmpty() && !seenMessageIds.add(messageId)) {
      Log.d("NearbyMesh", "NearbyMesh: duplicate message $messageId, dropping")
      return
    }

    Log.d("NearbyMesh", "NearbyMesh: text message received from $sourceEndpointId")
    sendEventToJS("onMessageReceived", messageJson)
    rebroadcastToAll(messageJson, sourceEndpointId)
  }

  // ── Binary payload handling (image + PTT) ────────────────────────────────

  private fun handleBinaryPayload(bytes: ByteArray, sourceEndpointId: String, payloadKind: String) {
    if (bytes.size < 3) return

    val metaLen = ((bytes[1].toInt() and 0xFF) shl 8) or (bytes[2].toInt() and 0xFF)
    if (bytes.size < 3 + metaLen) return

    val metaBytes = bytes.copyOfRange(3, 3 + metaLen)
    val dataBytes = bytes.copyOfRange(3 + metaLen, bytes.size)

    val meta = try {
      org.json.JSONObject(String(metaBytes, Charsets.UTF_8))
    } catch (e: Exception) {
      Log.w("NearbyMesh", "NearbyMesh: failed to parse binary metadata")
      return
    }

    val mediaId = meta.optString(if (payloadKind == "image") "image_id" else "audio_id", "")
    if (mediaId.isEmpty()) return

    // Dedup
    if (!seenMessageIds.add(mediaId)) {
      Log.d("NearbyMesh", "NearbyMesh: duplicate $payloadKind $mediaId, dropping")
      return
    }

    // Save to cache and emit to JS
    saveBinaryAndEmit(dataBytes, meta, payloadKind)

    // Relay if TTL > 0
    val currentTtl = meta.optInt("ttl", 0)
    if (currentTtl > 0) {
      rebroadcastBinaryToAll(bytes[0], meta, dataBytes, sourceEndpointId)
    }
  }

  private fun saveBinaryAndEmit(dataBytes: ByteArray, meta: org.json.JSONObject, payloadKind: String) {
    try {
      val cacheDir = reactApplicationContext.cacheDir
      val isImage = payloadKind == "image"
      val mediaId = meta.optString(if (isImage) "image_id" else "audio_id", UUID.randomUUID().toString())
      val ext = if (isImage) "jpg" else "m4a"
      val outFile = File(cacheDir, "recv_${payloadKind}_$mediaId.$ext")
      FileOutputStream(outFile).use { it.write(dataBytes) }

      val eventParams = Arguments.createMap().apply {
        putString("type", if (isImage) "image_received" else "ptt_received")
        putString(if (isImage) "image_id" else "audio_id", mediaId)
        putString("sender_id", meta.optString("sender_id", ""))
        putString("recipient_id", meta.optString("recipient_id", ""))
        putString("local_uri", "file://${outFile.absolutePath}")
        putString("transfer_mode", meta.optString("transfer_mode", "mesh"))
        if (!isImage) putInt("duration_ms", meta.optInt("duration_ms", 0))
      }

      val eventName = if (isImage) "onImageReceived" else "onPttAudioReceived"
      emitEvent(eventName, eventParams)
      Log.d("NearbyMesh", "NearbyMesh: $payloadKind saved → ${outFile.name}")
    } catch (e: Exception) {
      Log.e("NearbyMesh", "NearbyMesh: failed to save $payloadKind: ${e.message}")
    }
  }

  private fun rebroadcastBinaryToAll(
    typeByte: Byte,
    meta: org.json.JSONObject,
    dataBytes: ByteArray,
    excludeEndpointId: String,
  ) {
    try {
      val updatedMeta = org.json.JSONObject(meta.toString())
      val newTtl = updatedMeta.optInt("ttl", 0) - 1
      if (newTtl < 0) return
      updatedMeta.put("ttl", newTtl)
      updatedMeta.put("hop_count", updatedMeta.optInt("hop_count", 0) + 1)

      val newMetaBytes = updatedMeta.toString().toByteArray(Charsets.UTF_8)
      val newMetaLen = newMetaBytes.size
      val fullPayload = ByteArray(3 + newMetaLen + dataBytes.size)
      fullPayload[0] = typeByte
      fullPayload[1] = (newMetaLen shr 8).toByte()
      fullPayload[2] = (newMetaLen and 0xFF).toByte()
      System.arraycopy(newMetaBytes, 0, fullPayload, 3, newMetaLen)
      System.arraycopy(dataBytes, 0, fullPayload, 3 + newMetaLen, dataBytes.size)

      val payload = Payload.fromBytes(fullPayload)
      connectedEndpoints
        .filter { it != excludeEndpointId }
        .forEach { endpointId ->
          Nearby.getConnectionsClient(reactApplicationContext).sendPayload(endpointId, payload)
        }
    } catch (e: Exception) {
      Log.e("NearbyMesh", "NearbyMesh: binary relay failed: ${e.message}")
    }
  }

  // ── Text relay (unchanged) ───────────────────────────────────────────────

  private fun rebroadcastToAll(messageJson: String, excludeEndpointId: String) {
    val relayJson = try {
      val obj = org.json.JSONObject(messageJson)
      val msgTtl = obj.optInt("ttl", 0)
      if (msgTtl <= 0) return
      obj.put("ttl", msgTtl - 1)
      obj.put("hop_count", obj.optInt("hop_count", 0) + 1)
      obj.toString()
    } catch (e: Exception) {
      Log.w("NearbyMesh", "NearbyMesh: failed to update TTL/hop_count, dropping message")
      return
    }
    connectedEndpoints
      .filter { it != excludeEndpointId }
      .forEach { endpointId ->
        val payload = Payload.fromBytes(relayJson.toByteArray(Charsets.UTF_8))
        Nearby.getConnectionsClient(reactApplicationContext)
          .sendPayload(endpointId, payload)
      }
  }

  private fun sendAcknowledgement(originalJson: String, toEndpointId: String) {
    try {
      val obj = org.json.JSONObject(originalJson)
      val ack = org.json.JSONObject()
      ack.put("message_id", obj.getString("message_id"))
      ack.put("message_type", "ack")
      ack.put("destination_id", obj.getString("sender_id"))
      ack.put("sender_id", deviceId)
      val payload = Payload.fromBytes(ack.toString().toByteArray(Charsets.UTF_8))
      Nearby.getConnectionsClient(reactApplicationContext)
        .sendPayload(toEndpointId, payload)
    } catch (e: Exception) {
      Log.e("NearbyMesh", "Failed to send ack: ${e.message}")
    }
  }

  // ── New: sendImage ───────────────────────────────────────────────────────

  @ReactMethod
  fun sendImage(
    recipientId: String,
    highQualityPath: String,
    lowQualityPath: String,
    promise: Promise,
  ) {
    try {
      val imageId = UUID.randomUUID().toString()

      // Check if recipient is directly connected
      val recipientEndpoint = endpointToDeviceId.entries.find { it.value == recipientId }?.key
      val isDirectlyConnected = recipientEndpoint != null &&
        synchronized(connectedEndpoints) { connectedEndpoints.contains(recipientEndpoint) }

      val (filePath, transferMode, imageTtl) = if (isDirectlyConnected) {
        Triple(highQualityPath.removePrefix("file://"), "direct", 0)
      } else {
        Triple(lowQualityPath.removePrefix("file://"), "mesh", 2)
      }

      val imageFile = File(filePath)
      if (!imageFile.exists()) {
        promise.reject("FILE_NOT_FOUND", "Image file not found: $filePath")
        return
      }
      val imageBytes = imageFile.readBytes()

      val meta = org.json.JSONObject().apply {
        put("image_id", imageId)
        put("sender_id", deviceId)
        put("recipient_id", recipientId)
        put("transfer_mode", transferMode)
        put("file_size", imageBytes.size)
        put("ttl", imageTtl)
        put("hop_count", 0)
        put("timestamp", System.currentTimeMillis())
      }

      val fullPayload = buildBinaryPayload(BYTE_IMAGE, meta, imageBytes)

      // Mark as seen so we don't loop on our own send
      seenMessageIds.add(imageId)

      val endpointIds = if (isDirectlyConnected && recipientEndpoint != null) {
        listOf(recipientEndpoint)
      } else {
        synchronized(connectedEndpoints) { connectedEndpoints.toList() }
      }

      if (endpointIds.isEmpty()) {
        promise.reject("NO_PEERS", "No connected peers to send image")
        return
      }

      val payload = Payload.fromBytes(fullPayload)
      endpointIds.forEach { endpointId ->
        Nearby.getConnectionsClient(reactApplicationContext).sendPayload(endpointId, payload)
      }

      Log.d("NearbyMesh", "NearbyMesh: image sent via $transferMode to ${endpointIds.size} endpoint(s)")

      val result = Arguments.createMap().apply {
        putString("image_id", imageId)
        putString("transfer_mode", transferMode)
        putInt("peer_count", endpointIds.size)
      }
      promise.resolve(result)
    } catch (e: Exception) {
      Log.e("NearbyMesh", "NearbyMesh: sendImage error: ${e.message}")
      promise.reject("SEND_IMAGE_ERROR", e.message)
    }
  }

  // ── New: sendPttAudio ────────────────────────────────────────────────────

  @ReactMethod
  fun sendPttAudio(
    recipientId: String,
    audioPath: String,
    durationMs: Int,
    promise: Promise,
  ) {
    try {
      val audioId = UUID.randomUUID().toString()
      val cleanPath = audioPath.removePrefix("file://")
      val audioFile = File(cleanPath)
      if (!audioFile.exists()) {
        promise.reject("FILE_NOT_FOUND", "Audio file not found: $cleanPath")
        return
      }
      val audioBytes = audioFile.readBytes()

      val meta = org.json.JSONObject().apply {
        put("audio_id", audioId)
        put("sender_id", deviceId)
        put("recipient_id", recipientId)
        put("duration_ms", durationMs)
        put("ttl", 3)
        put("hop_count", 0)
        put("timestamp", System.currentTimeMillis())
      }

      val fullPayload = buildBinaryPayload(BYTE_PTT, meta, audioBytes)

      seenMessageIds.add(audioId)

      val endpointIds = synchronized(connectedEndpoints) { connectedEndpoints.toList() }
      if (endpointIds.isEmpty()) {
        promise.reject("NO_PEERS", "No connected peers for PTT")
        return
      }

      val payload = Payload.fromBytes(fullPayload)
      endpointIds.forEach { endpointId ->
        Nearby.getConnectionsClient(reactApplicationContext).sendPayload(endpointId, payload)
      }

      Log.d("NearbyMesh", "NearbyMesh: PTT sent (${audioBytes.size} bytes) to ${endpointIds.size} peer(s)")

      val result = Arguments.createMap().apply {
        putString("audio_id", audioId)
        putInt("peer_count", endpointIds.size)
      }
      promise.resolve(result)
    } catch (e: Exception) {
      Log.e("NearbyMesh", "NearbyMesh: sendPttAudio error: ${e.message}")
      promise.reject("SEND_PTT_ERROR", e.message)
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private fun buildBinaryPayload(
    typeByte: Byte,
    meta: org.json.JSONObject,
    dataBytes: ByteArray,
  ): ByteArray {
    val metaBytes = meta.toString().toByteArray(Charsets.UTF_8)
    val metaLen = metaBytes.size
    val result = ByteArray(3 + metaLen + dataBytes.size)
    result[0] = typeByte
    result[1] = (metaLen shr 8).toByte()
    result[2] = (metaLen and 0xFF).toByte()
    System.arraycopy(metaBytes, 0, result, 3, metaLen)
    System.arraycopy(dataBytes, 0, result, 3 + metaLen, dataBytes.size)
    return result
  }

  private fun sendEventToJS(eventName: String, messageJson: String) {
    emitEvent(
      eventName,
      Arguments.createMap().apply {
        putString("message", messageJson)
      }
    )
  }

  // ── Connection lifecycle ─────────────────────────────────────────────────

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
      endpointToDeviceId.remove(endpointId)
      Log.i("NearbyMesh", "NearbyMesh: peer disconnected — total peers: $peerCount")
      emitPeerEvent("onPeerDisconnected", endpointId, peerCount)
    }
  }

  private val discoveryCallback = object : EndpointDiscoveryCallback() {
    override fun onEndpointFound(endpointId: String, discoveryInfo: DiscoveredEndpointInfo) {
      Log.i("NearbyMesh", "NearbyMesh: endpoint found: $endpointId")

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

    val serviceIntent = Intent(reactApplicationContext, MeshForegroundService::class.java)
    reactApplicationContext.startForegroundService(serviceIntent)

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
    val serviceIntent = Intent(reactApplicationContext, MeshForegroundService::class.java)
    reactApplicationContext.stopService(serviceIntent)

    connectionsClient.stopDiscovery()
    connectionsClient.stopAdvertising()
    connectionsClient.stopAllEndpoints()
    synchronized(connectedEndpoints) {
      connectedEndpoints.clear()
    }
    endpointToDeviceId.clear()
    meshRunning = false
    Log.i("NearbyMesh", "NearbyMesh: mesh stopped")
    promise.resolve(null)
  }

  @ReactMethod
  fun sendMessage(messageJson: String, promise: Promise) {
    try {
      val endpointIds = synchronized(connectedEndpoints) { connectedEndpoints.toList() }
      Log.d("NearbyMesh", "NearbyMesh: sendMessage called, endpoints: ${endpointIds.size}")
      Log.d("NearbyMesh", "NearbyMesh: message preview: ${messageJson.take(100)}")

      if (endpointIds.isEmpty()) {
        Log.w("NearbyMesh", "NearbyMesh: sendMessage — no connected endpoints, message dropped")
        promise.resolve(0)
        return
      }

      val payload = Payload.fromBytes(messageJson.toByteArray(Charsets.UTF_8))
      endpointIds.forEach { endpointId ->
        connectionsClient.sendPayload(endpointId, payload)
          .addOnSuccessListener {
            Log.d("NearbyMesh", "NearbyMesh: payload sent to: $endpointId")
          }
          .addOnFailureListener { e ->
            Log.e("NearbyMesh", "NearbyMesh: payload failed to $endpointId: ${e.message}")
          }
      }

      Log.d("NearbyMesh", "NearbyMesh: sendMessage dispatched to ${endpointIds.size} endpoints")
      promise.resolve(endpointIds.size)
    } catch (e: Exception) {
      Log.e("NearbyMesh", "NearbyMesh: sendMessage error: ${e.message}")
      promise.reject("SEND_ERROR", e.message)
    }
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
