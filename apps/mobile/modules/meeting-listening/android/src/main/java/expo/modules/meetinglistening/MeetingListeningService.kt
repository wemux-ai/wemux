package expo.modules.meetinglistening

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.RandomAccessFile
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.Collections
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private const val ACTION_START = "com.wemux.meeting-listening.START"
private const val ACTION_STOP = "com.wemux.meeting-listening.STOP"
private const val CHANNEL_ID = "wemux_meeting_listening"
private const val NOTIFICATION_ID = 4768
private const val SAMPLE_RATE = 16_000
private const val CHUNK_MS = 30_000L
private const val CHUNK_SAMPLES = SAMPLE_RATE * (CHUNK_MS / 1_000L).toInt()

private data class MeetingModelDefinition(
  val id: String,
  val fileName: String,
  val sizeBytes: Long,
  val sha256: String,
  val url: String,
)

private val MEETING_MODELS = listOf(
  MeetingModelDefinition(
    "moss-transcribe", "moss-transcribe-q4_k.gguf", 535_272_448L,
    "ac22065a8f9ad10416262a950e9e87e4e6b51ef90e07a42a1a62cb718a12623b",
    "https://huggingface.co/mudler/moss-transcribe.cpp-gguf/resolve/main/moss-transcribe-q4_k.gguf?download=true",
  ),
  MeetingModelDefinition(
    "minicpm5-value", "MiniCPM5-1B-Q4_K_M.gguf", 688_065_920L,
    "81b64d05a23b17b34c475f42b3e72fbde62d4b92cc34541f7a8031d0752deafa",
    "https://huggingface.co/openbmb/MiniCPM5-1B-GGUF/resolve/main/MiniCPM5-1B-Q4_K_M.gguf?download=true",
  ),
)

/** Downloads immutable quantized artifacts into app-private storage. */
object MeetingModelStore {
  private const val PREFS = "wemux-meeting-models"
  private const val MAX_DOWNLOAD_ATTEMPTS = 5
  private val lock = Any()
  private val activeDownloads = Collections.synchronizedSet(mutableSetOf<String>())

  init {
    // Some Android carriers advertise an unreachable IPv6 route for Hugging Face.
    // Prefer IPv4 so the download can use the device's working mobile route.
    System.setProperty("java.net.preferIPv4Stack", "true")
  }

  private fun definition(id: String) = MEETING_MODELS.firstOrNull { it.id == id }
    ?: throw IllegalArgumentException("unknown meeting model")

  private fun directory(context: Context) = File(context.filesDir, "meeting-models").apply { mkdirs() }

  private fun state(context: Context, model: MeetingModelDefinition): Map<String, Any?> {
    val target = File(directory(context), model.fileName)
    val metadata = File("${target.absolutePath}.json")
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val downloaded = target.length()
    val ready = target.isFile && downloaded == model.sizeBytes && runCatching {
      JSONObject(metadata.readText()).optString("sha256") == model.sha256
    }.getOrDefault(false)
    val downloading = prefs.getString("downloading", null) == model.id && activeDownloads.contains(model.id)
    return mapOf(
      "id" to model.id,
      "status" to when {
        downloading -> "downloading"
        ready -> "ready"
        prefs.getString("error-${model.id}", null) != null -> "error"
        else -> "not-downloaded"
      },
      "downloadedBytes" to if (downloading) prefs.getLong("bytes-${model.id}", downloaded) else if (ready) model.sizeBytes else downloaded,
      "totalBytes" to model.sizeBytes,
      "error" to if (ready) null else prefs.getString("error-${model.id}", null),
      "path" to if (ready) target.absolutePath else null,
      "inferenceReady" to (ready && NativeMeetingRuntime.isReady()),
      "inferenceBackendAvailable" to (ready && NativeMeetingRuntime.isAvailable()),
      "inferenceStatus" to when {
        !ready -> "model-not-downloaded"
        !NativeMeetingRuntime.isAvailable() -> "backend-unavailable"
        NativeMeetingRuntime.isReady() -> "ready"
        else -> "not-loaded"
      },
    )
  }

  fun snapshot(context: Context): Map<String, Any?> = mapOf(
    "supported" to true,
    "platform" to "android",
    "models" to MEETING_MODELS.map { state(context, it) },
  )

  fun download(context: Context, id: String): Map<String, Any?> {
    val model = definition(id)
    synchronized(lock) {
      val current = state(context, model)["status"]
      if (current == "ready" || current == "downloading") return snapshot(context)
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      // Keep one large model transfer active at a time. The progress marker is
      // shared, so allowing a second transfer would make the UI report the
      // wrong model and could remove the first job's marker on completion.
      val activeModel = prefs.getString("downloading", null)
      if (activeModel != null && activeDownloads.contains(activeModel)) return snapshot(context)
      // A process restart can leave the persisted marker behind. It is only a
      // progress hint, so clear it and let the next request resume the temp file.
      if (activeModel != null) prefs.edit().remove("downloading").apply()
      prefs.edit().putString("downloading", model.id).putLong("bytes-${model.id}", 0).remove("error-${model.id}").apply()
      activeDownloads.add(model.id)
      Thread {
        try {
          downloadBlocking(context, model)
        } finally {
          synchronized(lock) { activeDownloads.remove(model.id) }
        }
      }.start()
      return snapshot(context)
    }
  }

  private fun downloadBlocking(context: Context, model: MeetingModelDefinition) {
    synchronized(lock) {
      val target = File(directory(context), model.fileName)
      val temporary = File("${target.absolutePath}.download")
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      var lastError: Exception? = null
      for (attempt in 1..MAX_DOWNLOAD_ATTEMPTS) {
        var connection: HttpURLConnection? = null
        try {
          var offset = temporary.length()
          if (offset >= model.sizeBytes) {
            // A process can be killed after the final write but before rename.
            // Verify and install a complete temp file without issuing an invalid
            // Range request starting one byte past the artifact.
            if (offset == model.sizeBytes) {
              val digest = MessageDigest.getInstance("SHA-256")
              FileInputStream(temporary).use { input ->
                val buffer = ByteArray(1024 * 1024)
                while (true) {
                  val count = input.read(buffer)
                  if (count < 0) break
                  digest.update(buffer, 0, count)
                }
              }
              val actualHash = digest.digest().joinToString("") { byte -> "%02x".format(byte) }
              if (actualHash == model.sha256) {
                target.delete()
                check(temporary.renameTo(target)) { "unable to install downloaded model" }
                File("${target.absolutePath}.json").writeText(JSONObject().apply {
                  put("sha256", actualHash); put("sizeBytes", model.sizeBytes)
                }.toString())
                lastError = null
                break
              }
              temporary.delete()
            } else if (offset > model.sizeBytes) {
              temporary.delete()
            }
            offset = temporary.length()
          }
          connection = (URL(model.url).openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = true
            connectTimeout = 30_000
            readTimeout = 120_000
            requestMethod = "GET"
            useCaches = false
            setRequestProperty("Accept-Encoding", "identity")
            if (offset > 0) setRequestProperty("Range", "bytes=$offset-")
          }
          val status = connection.responseCode
          if (status !in 200..299) throw IllegalStateException("model download failed ($status)")
          val append = offset > 0 && status == HttpURLConnection.HTTP_PARTIAL
          if (offset > 0 && !append) {
            // The endpoint ignored Range; restart from a clean temporary file.
            temporary.delete()
            continue
          }

          val digest = MessageDigest.getInstance("SHA-256")
          var received = 0L
          if (append) {
            FileInputStream(temporary).use { prefix ->
              val buffer = ByteArray(1024 * 1024)
              while (true) {
                val count = prefix.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
                received += count
              }
            }
          }
          BufferedInputStream(connection.inputStream).use { input ->
            FileOutputStream(temporary, append).use { output ->
              val buffer = ByteArray(1024 * 1024)
              while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                output.write(buffer, 0, count)
                digest.update(buffer, 0, count)
                received += count
                prefs.edit().putLong("bytes-${model.id}", received).apply()
              }
            }
          }
          val actualHash = digest.digest().joinToString("") { byte -> "%02x".format(byte) }
          if (received != model.sizeBytes) throw IllegalStateException("model size mismatch ($received bytes)")
          if (actualHash != model.sha256) throw IllegalStateException("model SHA-256 verification failed")
          target.delete()
          check(temporary.renameTo(target)) { "unable to install downloaded model" }
          File("${target.absolutePath}.json").writeText(JSONObject().apply {
            put("sha256", actualHash); put("sizeBytes", received)
          }.toString())
          lastError = null
          break
        } catch (error: Exception) {
          lastError = error
          if (attempt < MAX_DOWNLOAD_ATTEMPTS) {
            try {
              Thread.sleep(1_000L * attempt)
            } catch (_: InterruptedException) {
              Thread.currentThread().interrupt()
              break
            }
          }
        } finally {
          connection?.disconnect()
        }
      }
      if (lastError != null) {
        prefs.edit().remove("downloading").putString("error-${model.id}", lastError?.message ?: "model download failed").apply()
        return
      }
      prefs.edit().remove("downloading").remove("error-${model.id}").remove("bytes-${model.id}").apply()
    }
  }

  fun delete(context: Context, id: String): Map<String, Any?> {
    val model = definition(id)
    synchronized(lock) {
      val target = File(directory(context), model.fileName)
      target.delete(); File("${target.absolutePath}.json").delete(); File("${target.absolutePath}.download").delete()
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .remove("error-${model.id}").remove("bytes-${model.id}").apply()
      return snapshot(context)
    }
  }

  fun readyPaths(context: Context): Pair<String, String>? {
    val moss = MEETING_MODELS.firstOrNull { it.id == "moss-transcribe" } ?: return null
    val value = MEETING_MODELS.firstOrNull { it.id == "minicpm5-value" } ?: return null
    val mossPath = state(context, moss)["path"] as? String ?: return null
    val valuePath = state(context, value)["path"] as? String ?: return null
    return mossPath to valuePath
  }
}

private fun isoTime(milliseconds: Long): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
  timeZone = TimeZone.getTimeZone("UTC")
}.format(Date(milliseconds))

data class MeetingListeningConfig(
  val runtimeUrl: String,
  val runtimeToken: String,
  val apiUrl: String,
  val accessToken: String,
  val brainContext: String,
  val workspaceId: String,
  val meetingId: String,
) {
  fun toJson() = JSONObject().apply {
    put("runtimeUrl", runtimeUrl); put("runtimeToken", runtimeToken); put("apiUrl", apiUrl)
    put("accessToken", accessToken); put("brainContext", brainContext); put("workspaceId", workspaceId)
    put("meetingId", meetingId)
  }

  companion object {
    fun from(values: Map<String, Any?>): MeetingListeningConfig = fromJson(JSONObject(values))
    fun fromJson(values: JSONObject): MeetingListeningConfig {
      fun required(name: String) = values.optString(name).trim().also { require(it.isNotEmpty()) { "$name is required" } }
      return MeetingListeningConfig(
        values.optString("runtimeUrl").trim().removeSuffix("/"), values.optString("runtimeToken"),
        required("apiUrl").removeSuffix("/"), required("accessToken"), values.optString("brainContext").take(8_000),
        values.optString("workspaceId"), required("meetingId"),
      )
    }
  }
}

object MeetingListeningState {
  private const val PREFS = "wemux-meeting-listening-state"
  private const val MAX_TRANSCRIPT_CHARS = 20_000
  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  fun begin(context: Context) = prefs(context).edit()
    .putBoolean("running", true)
    .putLong("startedAtMs", System.currentTimeMillis())
    .putLong("recordedSec", 0)
    .remove("transcript")
    .remove("transcriptUpdatedAtMs")
    .remove("lastError")
    .apply()
  fun setRunning(context: Context, running: Boolean, startedAtMs: Long = 0L) = prefs(context).edit()
    .putBoolean("running", running).putLong("startedAtMs", startedAtMs).apply()
  fun setError(context: Context, error: String?) = prefs(context).edit().putString("lastError", error).apply()
  fun setTranscript(context: Context, transcript: String, updatedAtMs: Long) = prefs(context).edit()
    .putString("transcript", transcript.takeLast(MAX_TRANSCRIPT_CHARS))
    .putLong("transcriptUpdatedAtMs", updatedAtMs)
    .apply()
  fun snapshot(context: Context): Map<String, Any?> {
    val state = prefs(context)
    return mapOf(
      "supported" to true,
      "running" to state.getBoolean("running", false),
      "startedAtMs" to state.getLong("startedAtMs", 0L).takeIf { it > 0 },
      "mode" to if (state.getBoolean("running", false)) "recording" else "idle",
      "recordedSec" to state.getLong("recordedSec", 0L),
      "pendingUploads" to PendingSegmentStore(context).count(),
      "lastError" to state.getString("lastError", null),
      "transcript" to state.getString("transcript", ""),
      "transcriptUpdatedAtMs" to state.getLong("transcriptUpdatedAtMs", 0L).takeIf { it > 0 },
    )
  }
  fun addRecorded(context: Context, milliseconds: Long) = prefs(context).edit()
    .putLong("recordedSec", prefs(context).getLong("recordedSec", 0L) + milliseconds / 1000).apply()
}

class PendingSegmentStore(private val context: Context) {
  private companion object {
    const val KEY_ALIAS = "wemux-meeting-listening-queue-key"
    const val TRANSFORMATION = "AES/GCM/NoPadding"
  }
  private val directory = File(context.filesDir, "meeting-listening").apply { mkdirs() }
  fun count() = directory.listFiles { file -> file.extension == "json" }?.size ?: 0
  fun add(config: MeetingListeningConfig, audio: File, startedAtMs: Long, endedAtMs: Long) {
    val job = JSONObject().apply {
      put("config", config.toJson()); put("audioPath", audio.absolutePath)
      put("startedAtMs", startedAtMs); put("endedAtMs", endedAtMs)
    }
    val target = File(directory, "${startedAtMs}-${UUID.randomUUID()}.json")
    val temporary = File(directory, ".${target.name}.tmp")
    temporary.writeText(encrypt(job).toString())
    check(temporary.renameTo(target)) { "Unable to persist encrypted meeting segment" }
  }
  fun jobs() = directory.listFiles { file -> file.extension == "json" }?.sortedBy { it.name } ?: emptyList()
  fun read(job: File): JSONObject {
    val stored = JSONObject(job.readText())
    if (stored.has("payload") && stored.has("iv")) return decrypt(stored)

    // Migrate queues written by development builds before encrypted jobs shipped.
    job.writeText(encrypt(stored).toString())
    return stored
  }
  fun delete(job: File) = job.delete()

  private fun encrypt(job: JSONObject): JSONObject {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val payload = cipher.doFinal(job.toString().toByteArray(Charsets.UTF_8))
    return JSONObject().apply {
      put("version", 1)
      put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      put("payload", Base64.encodeToString(payload, Base64.NO_WRAP))
    }
  }

  private fun decrypt(stored: JSONObject): JSONObject {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(stored.getString("iv"), Base64.NO_WRAP)))
    val plaintext = cipher.doFinal(Base64.decode(stored.getString("payload"), Base64.NO_WRAP))
    return JSONObject(String(plaintext, Charsets.UTF_8))
  }

  private fun key(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .build())
    }.generateKey()
  }
}

/** Keeps restart-required tokens out of cleartext preferences and Android backups. */
object MeetingListeningConfigStore {
  private const val PREFS = "wemux-meeting-listening-config"
  private const val KEY_ALIAS = "wemux-meeting-listening-config-key"
  private const val TRANSFORMATION = "AES/GCM/NoPadding"

  fun save(context: Context, config: MeetingListeningConfig) {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val payload = cipher.doFinal(config.toJson().toString().toByteArray(Charsets.UTF_8))
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .putString("payload", Base64.encodeToString(payload, Base64.NO_WRAP))
      .apply()
  }

  fun load(context: Context): MeetingListeningConfig? = runCatching {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val iv = Base64.decode(prefs.getString("iv", null), Base64.NO_WRAP)
    val payload = Base64.decode(prefs.getString("payload", null), Base64.NO_WRAP)
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
    MeetingListeningConfig.fromJson(JSONObject(String(cipher.doFinal(payload), Charsets.UTF_8)))
  }.getOrNull()

  private fun key(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .build())
    }.generateKey()
  }
}

class MeetingListeningService : Service() {
  private val running = AtomicBoolean(false)
  private val processor = Executors.newSingleThreadExecutor()
  private var captureThread: Thread? = null
  private var recorder: AudioRecord? = null
  private lateinit var config: MeetingListeningConfig

  companion object {
    fun start(context: Context, config: MeetingListeningConfig) {
      val modelPaths = MeetingModelStore.readyPaths(context)
        ?: throw IllegalStateException("请先在设置中下载 MOSS 和 MiniCPM5 两个端侧模型")
      if (!NativeMeetingRuntime.load(modelPaths.first, modelPaths.second)) {
        throw IllegalStateException(NativeMeetingRuntime.lastError().ifBlank { "端侧模型加载失败" })
      }
      MeetingListeningConfigStore.save(context, config)
      // Native startService is asynchronous; publish a new session immediately
      // so the WebView does not offer a second start before onStartCommand runs.
      MeetingListeningState.begin(context)
      val intent = Intent(context, MeetingListeningService::class.java).setAction(ACTION_START)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
    }
    fun stop(context: Context) {
      context.stopService(Intent(context, MeetingListeningService::class.java))
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    createChannel()
    startForegroundCompat(notification())
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) { stopSelf(); return START_NOT_STICKY }
    if (running.getAndSet(true)) return START_STICKY
    config = MeetingListeningConfigStore.load(this) ?: run {
      MeetingListeningState.setError(this, "缺少或无法读取背后听写配置")
      stopSelf()
      return START_NOT_STICKY
    }
    val modelPaths = MeetingModelStore.readyPaths(this) ?: run {
      MeetingListeningState.setError(this, "请先在设置中下载 MOSS 和 MiniCPM5 两个端侧模型")
      stopSelf()
      return START_NOT_STICKY
    }
    if (!NativeMeetingRuntime.load(modelPaths.first, modelPaths.second)) {
      MeetingListeningState.setError(this, NativeMeetingRuntime.lastError().ifBlank { "端侧模型加载失败" })
      stopSelf()
      return START_NOT_STICKY
    }
    MeetingListeningState.setError(this, null)
    processor.submit { drainQueue() }
    captureThread = Thread(::capture, "wemux-meeting-microphone").also { it.start() }
    return START_STICKY
  }

  override fun onDestroy() {
    running.set(false)
    recorder?.runCatching { stop() }; recorder?.release(); recorder = null
    captureThread?.interrupt(); processor.shutdown()
    MeetingListeningState.setRunning(this, false)
    super.onDestroy()
  }

  private fun capture() {
    try {
      val size = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      require(size > 0) { "AudioRecord buffer unavailable" }
      val activeRecorder = AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT, size.coerceAtLeast(SAMPLE_RATE * 2))
      require(activeRecorder.state == AudioRecord.STATE_INITIALIZED) { "Unable to initialize microphone" }
      recorder = activeRecorder
      activeRecorder.startRecording()
      while (running.get()) recordChunk(activeRecorder)
    } catch (error: Exception) {
      MeetingListeningState.setError(this, error.message ?: "麦克风录音失败")
      stopSelf()
    }
  }

  private fun recordChunk(activeRecorder: AudioRecord) {
    val startedAtMs = System.currentTimeMillis()
    val audio = File(filesDir, "meeting-listening/${startedAtMs}-${UUID.randomUUID()}.wav")
    audio.parentFile?.mkdirs()
    RandomAccessFile(audio, "rw").use { output ->
      output.write(ByteArray(44))
      val buffer = ByteArray(4096)
      var dataBytes = 0
      var samplesWritten = 0
      while (running.get() && samplesWritten < CHUNK_SAMPLES) {
        val read = activeRecorder.read(buffer, 0, buffer.size, AudioRecord.READ_BLOCKING)
        if (read > 0) {
          val bytesToWrite = (read / 2).coerceAtMost(CHUNK_SAMPLES - samplesWritten) * 2
          if (bytesToWrite > 0) {
            output.write(buffer, 0, bytesToWrite)
            dataBytes += bytesToWrite
            samplesWritten += bytesToWrite / 2
          }
        }
      }
      writeWavHeader(output, dataBytes)
    }
    val endedAtMs = System.currentTimeMillis()
    MeetingListeningState.addRecorded(this, endedAtMs - startedAtMs)
    if (audio.length() <= 44) { audio.delete(); return }
    PendingSegmentStore(this).add(config, audio, startedAtMs, endedAtMs)
    if (!processor.isShutdown) processor.submit { drainQueue() }
  }

  private fun drainQueue() {
    val store = PendingSegmentStore(this)
    for (job in store.jobs()) {
      try {
        val payload = store.read(job)
        processJob(payload)
        File(payload.getString("audioPath")).delete()
        store.delete(job)
        MeetingListeningState.setError(this, null)
      } catch (error: Exception) {
        MeetingListeningState.setError(this, error.message ?: "片段同步失败，将在下次录音时重试")
        return
      }
    }
  }

  private fun processJob(job: JSONObject) {
    val jobConfig = MeetingListeningConfig.fromJson(job.getJSONObject("config"))
    val startedAtMs = job.getLong("startedAtMs")
    val endedAtMs = job.getLong("endedAtMs")
    val brainContext = refreshBrainContext(jobConfig).ifBlank { jobConfig.brainContext }
    val transcript = transcribeLocally(File(job.getString("audioPath")), startedAtMs, endedAtMs, brainContext)
    val segments = transcript.optJSONArray("segments") ?: JSONArray()
    val transcriptText = buildString {
      for (index in 0 until segments.length()) {
        val segment = segments.optJSONObject(index) ?: continue
        val text = segment.optString("transcript").trim()
        if (text.isBlank()) continue
        if (isNotEmpty()) append('\n')
        val speaker = segment.optString("speakerId").trim()
        if (speaker.isNotBlank()) append(speaker).append(": ")
        append(text)
      }
    }
    if (transcriptText.isNotBlank()) MeetingListeningState.setTranscript(this, transcriptText, endedAtMs)
    for (index in 0 until segments.length()) {
      val segment = segments.optJSONObject(index) ?: continue
      if (!segment.optBoolean("valuable") || segment.optString("transcript").isBlank()) continue
      uploadValuableSegment(jobConfig, segment, startedAtMs, endedAtMs)
    }
  }

  /** MOSS and MiniCPM5 execute in this process; only value-bearing JSON leaves the device. */
  private fun transcribeLocally(audio: File, startedAtMs: Long, endedAtMs: Long, brainContext: String): JSONObject {
    val raw = NativeMeetingRuntime.transcribeWav(audio.absolutePath)
    val segments = JSONArray()
    fun addSegment(text: String, startOffset: Double, endOffset: Double, speakerId: String? = null) {
      val verdict = parseVerdict(NativeMeetingRuntime.judge(text, brainContext))
      segments.put(JSONObject().apply {
        put("startedAt", isoTime(startedAtMs + (startOffset * 1000).toLong()))
        put("endedAt", isoTime(startedAtMs + (endOffset * 1000).toLong()))
        put("transcript", text)
        if (!speakerId.isNullOrBlank()) put("speakerId", speakerId)
        put("valuable", verdict.optBoolean("valuable", false))
        put("valueLabel", verdict.optString("valueLabel").takeIf { it.isNotBlank() })
        put("confidence", verdict.optDouble("confidence", 0.0).coerceIn(0.0, 1.0))
        put("channels", verdict.optJSONArray("channels") ?: JSONArray())
      })
    }
    val pattern = Regex("\\[(\\d+(?:\\.\\d+)?)\\]\\[(S\\d+)\\](.*?)(?=\\[\\d+(?:\\.\\d+)?\\]|$)", setOf(RegexOption.DOT_MATCHES_ALL))
    for (match in pattern.findAll(raw)) {
      val text = match.groupValues[3].trim()
      if (text.isBlank()) continue
      val startOffset = match.groupValues[1].toDoubleOrNull() ?: continue
      val marker = Regex("\\[(\\d+(?:\\.\\d+)?)\\]").find(raw, match.range.last + 1)
      val endOffset = marker?.groupValues?.get(1)?.toDoubleOrNull()
        ?: (startOffset + ((endedAtMs - startedAtMs).coerceAtLeast(1) / 1000.0))
      addSegment(text, startOffset, endOffset, match.groupValues[2])
    }
    if (segments.length() == 0) {
      val fallback = raw
        .replace(Regex("\\[(?:\\d+(?:\\.\\d+)?|S\\d+)\\]"), " ")
        .replace(Regex("\\s+"), " ")
        .trim()
      if (fallback.isNotBlank()) {
        addSegment(fallback, 0.0, (endedAtMs - startedAtMs).coerceAtLeast(1) / 1000.0)
      }
    }
    return JSONObject().put("segments", segments)
  }

  private fun parseVerdict(raw: String): JSONObject = runCatching {
    val start = raw.indexOf('{')
    val end = raw.lastIndexOf('}')
    require(start >= 0 && end > start)
    JSONObject(raw.substring(start, end + 1))
  }.getOrDefault(JSONObject().put("valuable", false).put("confidence", 0.0).put("channels", JSONArray()))

  private fun refreshBrainContext(config: MeetingListeningConfig): String {
    if (config.workspaceId.isBlank()) return config.brainContext
    return runCatching {
      val body = request("${config.apiUrl}/api/collab/workspaces/${config.workspaceId}/brain/overview", "GET",
        mapOf("Authorization" to "Bearer ${config.accessToken}"))
      val overview = JSONObject(body)
      val lines = mutableListOf(overview.optJSONObject("config")?.optString("brainInstructions").orEmpty())
      val summary = overview.optJSONObject("context")?.optJSONArray("summaryLines") ?: JSONArray()
      for (index in 0 until summary.length()) lines += summary.optString(index)
      lines.filter { it.isNotBlank() }.joinToString("\n").take(8_000)
    }.getOrDefault(config.brainContext)
  }

  private fun uploadValuableSegment(config: MeetingListeningConfig, segment: JSONObject, startedAtMs: Long, endedAtMs: Long) {
    val channels = segment.optJSONArray("channels") ?: JSONArray()
    val normalized = JSONArray().put("cloud_db")
    for (index in 0 until channels.length()) if (channels.optString(index) != "cloud_db") normalized.put(channels.optString(index))
    val upload = JSONObject().apply {
      put("segmentId", "mobile-${UUID.randomUUID()}"); put("meetingId", config.meetingId)
      put("deviceId", "android-${Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)}")
      put("startedAt", segment.optString("startedAt", isoTime(startedAtMs)))
      put("endedAt", segment.optString("endedAt", isoTime(endedAtMs)))
      put("durationSec", ((endedAtMs - startedAtMs) / 1000).coerceAtLeast(1)); put("transcript", segment.getString("transcript").trim())
      if (segment.has("speakerId")) put("speakerId", segment.getString("speakerId")); if (segment.has("valueLabel")) put("valueLabel", segment.getString("valueLabel"))
      if (segment.has("confidence")) put("confidence", segment.getDouble("confidence")); put("channels", normalized)
      put("isMeeting", true); put("meetingTitle", "背后听写")
    }
    val body = JSONObject().put("upload", upload)
    if (config.workspaceId.isNotBlank()) body.put("workspaceId", config.workspaceId)
    request("${config.apiUrl}/api/meeting-intelligence/segments", "POST", mapOf(
      "Authorization" to "Bearer ${config.accessToken}", "Content-Type" to "application/json"), body.toString())
  }

  private fun request(url: String, method: String, headers: Map<String, String>, body: String? = null): String {
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.requestMethod = method; connection.connectTimeout = 15_000; connection.readTimeout = 60_000
    headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
    if (body != null) { connection.doOutput = true; connection.outputStream.bufferedWriter().use { it.write(body) } }
    return readResponse(connection)
  }

  private fun readResponse(connection: HttpURLConnection): String {
    val status = connection.responseCode
    val stream = if (status in 200..299) connection.inputStream else connection.errorStream
    val response = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
    connection.disconnect()
    if (status !in 200..299) throw IllegalStateException("请求失败（$status）")
    return response
  }

  private fun writeWavHeader(output: RandomAccessFile, dataBytes: Int) {
    output.seek(0); output.writeBytes("RIFF"); output.writeInt(Integer.reverseBytes(36 + dataBytes)); output.writeBytes("WAVEfmt ")
    output.writeInt(Integer.reverseBytes(16)); output.writeShort(java.lang.Short.reverseBytes(1.toShort()).toInt()); output.writeShort(java.lang.Short.reverseBytes(1.toShort()).toInt())
    output.writeInt(Integer.reverseBytes(SAMPLE_RATE)); output.writeInt(Integer.reverseBytes(SAMPLE_RATE * 2)); output.writeShort(java.lang.Short.reverseBytes(2.toShort()).toInt())
    output.writeShort(java.lang.Short.reverseBytes(16.toShort()).toInt()); output.writeBytes("data"); output.writeInt(Integer.reverseBytes(dataBytes))
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "背后听写", NotificationManager.IMPORTANCE_LOW))
  }
  private fun notification(): Notification {
    val stop = PendingIntent.getService(this, 1, Intent(this, MeetingListeningService::class.java).setAction(ACTION_STOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
    return builder.setContentTitle("Wemux 背后听写").setContentText("正在本地录音与转写").setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setOngoing(true).addAction(Notification.Action.Builder(null, "停止", stop).build()).build()
  }
  private fun startForegroundCompat(notification: Notification) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    else startForeground(NOTIFICATION_ID, notification)
  }
}
