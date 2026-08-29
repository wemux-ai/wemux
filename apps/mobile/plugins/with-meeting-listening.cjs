const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins')

const SERVICE_NAME = 'expo.modules.meetinglistening.MeetingListeningService'

module.exports = (config) => {
  return withAndroidManifest(config, (nextConfig) => {
    const androidManifest = nextConfig.modResults
    const manifest = androidManifest.manifest
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest)
    // The retry queue includes raw audio and short-lived access credentials.
    application.$['android:allowBackup'] = 'false'
    const permissions = manifest['uses-permission'] ?? (manifest['uses-permission'] = [])
    const ensurePermission = (name) => {
      if (!permissions.some((permission) => permission.$?.['android:name'] === name)) {
        permissions.push({ $: { 'android:name': name } })
      }
    }
    ensurePermission('android.permission.FOREGROUND_SERVICE')
    ensurePermission('android.permission.FOREGROUND_SERVICE_MICROPHONE')
    ensurePermission('android.permission.RECORD_AUDIO')
    ensurePermission('android.permission.WAKE_LOCK')

    const services = application.service ?? (application.service = [])
    if (!services.some((service) => service.$?.['android:name'] === SERVICE_NAME)) {
      services.push({
        $: {
          'android:name': SERVICE_NAME,
          'android:exported': 'false',
          'android:foregroundServiceType': 'microphone',
        },
        'intent-filter': [{ action: [{ $: { 'android:name': 'com.wemux.meeting-listening.STOP' } }] }],
      })
    }
    return nextConfig
  })
}
