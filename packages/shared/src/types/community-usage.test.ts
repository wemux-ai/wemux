import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  COMMUNITY_USAGE_SCHEMA_VERSION,
  isValidCommunityUsageInstallId,
  sanitizeCommunityUsageCounters,
} from './community-usage'

describe('sanitizeCommunityUsageCounters', () => {
  it('保留合法非负整数', () => {
    const counters = sanitizeCommunityUsageCounters({
      usersTotal: 12,
      teamsTotal: 3,
      tasksTotal: 45.0,
      conversationsTotal: 7,
      agentRunsTotal: 99,
    })
    assert.deepEqual(counters, {
      usersTotal: 12,
      teamsTotal: 3,
      tasksTotal: 45,
      conversationsTotal: 7,
      agentRunsTotal: 99,
    })
  })

  it('非法/缺失/负数/浮点一律归零或取整', () => {
    const counters = sanitizeCommunityUsageCounters({
      usersTotal: -5,
      teamsTotal: 'abc',
      tasksTotal: 3.7,
      conversationsTotal: Number.MAX_SAFE_INTEGER + 1,
    })
    assert.equal(counters.usersTotal, 0)
    assert.equal(counters.teamsTotal, 0)
    assert.equal(counters.tasksTotal, 3)
    assert.equal(counters.conversationsTotal, Number.MAX_SAFE_INTEGER)
    assert.equal(counters.agentRunsTotal, 0)
  })

  it('非对象输入返回全零', () => {
    for (const raw of [null, undefined, 42, 'x', []]) {
      const counters = sanitizeCommunityUsageCounters(raw)
      assert.deepEqual(counters, {
        usersTotal: 0,
        teamsTotal: 0,
        tasksTotal: 0,
        conversationsTotal: 0,
        agentRunsTotal: 0,
      })
    }
  })

  it('忽略白名单之外的字段', () => {
    const counters = sanitizeCommunityUsageCounters({
      usersTotal: 1,
      repoNames: ['internal-repo'],
      userEmail: 'a@b.c',
    })
    assert.equal((counters as unknown as Record<string, unknown>).repoNames, undefined)
    assert.equal((counters as unknown as Record<string, unknown>).userEmail, undefined)
    assert.equal(counters.usersTotal, 1)
  })
})

describe('isValidCommunityUsageInstallId', () => {
  it('接受标准 UUID', () => {
    assert.ok(isValidCommunityUsageInstallId('6f9619ff-8b86-d011-b42d-00c04fc964ff'))
    assert.ok(isValidCommunityUsageInstallId('6F9619FF-8B86-D011-B42D-00C04FC964FF'))
  })

  it('拒绝非 UUID / 非字符串', () => {
    assert.ok(!isValidCommunityUsageInstallId('not-a-uuid'))
    assert.ok(!isValidCommunityUsageInstallId('drop table users; --'))
    assert.ok(!isValidCommunityUsageInstallId(123))
    assert.ok(!isValidCommunityUsageInstallId(undefined))
  })
})

describe('COMMUNITY_USAGE_SCHEMA_VERSION', () => {
  it('当前为 v1', () => {
    assert.equal(COMMUNITY_USAGE_SCHEMA_VERSION, 1)
  })
})
