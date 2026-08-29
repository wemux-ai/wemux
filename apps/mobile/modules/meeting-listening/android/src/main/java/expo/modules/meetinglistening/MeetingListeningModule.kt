package expo.modules.meetinglistening

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MeetingListeningModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WemuxMeetingListening")

    AsyncFunction("start") { options: Map<String, Any?> ->
      val context = appContext.reactContext ?: throw IllegalStateException("Wemux is not ready")
      MeetingListeningService.start(context, MeetingListeningConfig.from(options))
    }

    AsyncFunction("stop") {
      val context = appContext.reactContext ?: throw IllegalStateException("Wemux is not ready")
      MeetingListeningService.stop(context)
    }

    AsyncFunction("status") {
      val context = appContext.reactContext ?: throw IllegalStateException("Wemux is not ready")
      MeetingListeningState.snapshot(context)
    }

    AsyncFunction("meetingModelsStatus") {
      val context = appContext.reactContext ?: throw IllegalStateException("Wemux is not ready")
      MeetingModelStore.snapshot(context)
    }

    AsyncFunction("meetingModelDownload") { modelId: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("Wemux is not ready")
      MeetingModelStore.download(context, modelId)
    }

    AsyncFunction("meetingModelDelete") { modelId: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("Wemux is not ready")
      MeetingModelStore.delete(context, modelId)
    }
  }
}
