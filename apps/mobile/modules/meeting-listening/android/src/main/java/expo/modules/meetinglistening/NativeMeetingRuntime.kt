package expo.modules.meetinglistening

/** JNI facade for the two GGUF models used by Backstage Dictation. */
object NativeMeetingRuntime {
  private var loadAttempted = false
  private var libraryLoaded = false

  init {
    try {
      System.loadLibrary("wemux_meeting_runtime")
      libraryLoaded = true
    } catch (_: UnsatisfiedLinkError) {
      libraryLoaded = false
    }
  }

  fun isAvailable(): Boolean = libraryLoaded

  fun load(mossPath: String, valuePath: String): Boolean {
    if (!libraryLoaded) return false
    loadAttempted = true
    return nativeLoad(mossPath, valuePath)
  }

  fun isReady(): Boolean = libraryLoaded && nativeIsReady()

  fun transcribeWav(path: String): String {
    check(isReady()) { nativeLastError().ifBlank { "本地会议模型尚未加载" } }
    return nativeTranscribeWav(path) ?: error(nativeLastError().ifBlank { "本地转写失败" })
  }

  fun judge(transcript: String, brainContext: String): String {
    check(isReady()) { nativeLastError().ifBlank { "本地会议模型尚未加载" } }
    return nativeJudge(transcript, brainContext) ?: error(nativeLastError().ifBlank { "本地价值判断失败" })
  }

  fun lastError(): String = if (libraryLoaded) nativeLastError() else "Android native runtime library unavailable"

  private external fun nativeLoad(mossPath: String, valuePath: String): Boolean
  private external fun nativeIsReady(): Boolean
  private external fun nativeTranscribeWav(path: String): String?
  private external fun nativeJudge(transcript: String, brainContext: String): String?
  private external fun nativeLastError(): String
}
