import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPushNotification,
  notifyUserPush,
  type PushDevice,
  type PushProvider,
  type PushSendResult,
} from './push-gateway'

/** 测试替身：记录收到的通知，可配置失败 */
class FakeProvider implements PushProvider {
  readonly platform: 'ios' | 'android'
  readonly received: { device: PushDevice; notification: { eventType: string; title: string } }[] = []
  failNext = false

  constructor(platform: 'ios' | 'android') {
    this.platform = platform
  }

  async send(device: PushDevice, notification: { eventType: string; title: string }): Promise<PushSendResult> {
    this.received.push({ device, notification })
    if (this.failNext) {
      return { ok: false, error: 'boom' }
    }
    return { ok: true }
  }
}

test('buildPushNotification 映射会议价值片段事件', () => {
  const notification = buildPushNotification('meeting.segment.valuable', {
    segmentId: 'seg-1',
    transcript: '下周发布提前到周三',
  })
  assert.ok(notification)
  assert.equal(notification?.title, '会议记录 · 新价值片段')
  assert.equal(notification?.route, '/meeting-records')
  assert.ok(notification?.body.includes('下周发布'))
})

test('buildPushNotification 未映射事件返回 null', () => {
  assert.equal(buildPushNotification('unknown.event', {}), null)
})

test('notifyUserPush 按平台路由到对应 provider', async () => {
  const iosProvider = new FakeProvider('ios')
  const androidProvider = new FakeProvider('android')
  const result = await notifyUserPush({
    userId: 'user-1',
    eventType: 'meeting.segment.valuable',
    payload: { segmentId: 'seg-1', transcript: '测试' },
    providers: [iosProvider, androidProvider],
    devices: [
      { id: 'dt-ios', userId: 'user-1', platform: 'ios', token: 'tok-ios' },
      { id: 'dt-android', userId: 'user-1', platform: 'android', token: 'tok-android' },
    ],
  })

  assert.equal(result.delivered, 2)
  assert.equal(result.failed, 0)
  assert.equal(iosProvider.received.length, 1)
  assert.equal(androidProvider.received.length, 1)
})

// 单设备失败不阻断其余设备（见下条测试）

test('单设备失败不阻断其余设备', async () => {
  const iosProvider = new FakeProvider('ios')
  iosProvider.failNext = true
  const androidProvider = new FakeProvider('android')
  const result = await notifyUserPush({
    userId: 'user-1',
    eventType: 'meeting.segment.valuable',
    payload: { segmentId: 'seg-1', transcript: 'x' },
    providers: [iosProvider, androidProvider],
    devices: [
      { id: 'dt-ios', userId: 'user-1', platform: 'ios', token: 'tok-ios' },
      { id: 'dt-android', userId: 'user-1', platform: 'android', token: 'tok-android' },
    ],
  })
  assert.equal(result.failed, 1) // ios 失败
  assert.equal(result.delivered, 1) // android 成功
  assert.ok(result.errors.some((error) => error.includes('boom')))
})

test('未配置 provider 返回明确错误', async () => {
  const iosProvider = new FakeProvider('ios')
  const result = await notifyUserPush({
    userId: 'user-2',
    eventType: 'meeting.segment.valuable',
    payload: { segmentId: 'seg-2', transcript: 'x' },
    providers: [iosProvider],
    devices: [
      { id: 'dt-ios', userId: 'user-2', platform: 'ios', token: 'tok-ios' },
      { id: 'dt-android', userId: 'user-2', platform: 'android', token: 'tok-android' },
    ],
  })
  assert.equal(result.failed, 1) // android 无 provider
  assert.equal(result.delivered, 1) // ios 成功
  assert.ok(result.errors.some((error) => error.includes('provider-not-configured')))
})
