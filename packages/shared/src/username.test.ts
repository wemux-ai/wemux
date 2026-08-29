import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildUniqueUsernameCandidate,
  buildUsernameCandidateFromEmail,
  isValidUsername,
  normalizeUsername,
} from './username'

test('合法 ID：3–20 位小写字母/数字/._-，不以分隔符开头结尾、不连续', () => {
  assert.equal(isValidUsername('zhangsan'), true)
  assert.equal(isValidUsername('zhang.san_2026'), true)
  assert.equal(isValidUsername('a.b-c_d'), true)
  assert.equal(isValidUsername('张三'), false)
  assert.equal(isValidUsername('ab'), false)
  assert.equal(isValidUsername('a'.repeat(21)), false)
  assert.equal(isValidUsername('-abc'), false)
  assert.equal(isValidUsername('abc-'), false)
  assert.equal(isValidUsername('a..b'), false)
  assert.equal(isValidUsername('a__b'), false)
  assert.equal(isValidUsername('a b'), false)
  assert.equal(isValidUsername(''), false)
})

test('归一化：转小写 + 去空白', () => {
  assert.equal(normalizeUsername(' ZhangSan '), 'zhangsan')
})

test('邮箱前缀生成候选：去特殊字符、截断、小写', () => {
  assert.equal(buildUsernameCandidateFromEmail('Zhang.San@example.com'), 'zhangsan')
  assert.equal(buildUsernameCandidateFromEmail('a@b.com'), 'a')
  assert.ok(buildUsernameCandidateFromEmail('').length > 0)
})

test('唯一候选：冲突时追加随机后缀且长度不超限', () => {
  const base = buildUsernameCandidateFromEmail('zhangsan@example.com')
  assert.ok(base.length <= 20)
  const unique = buildUniqueUsernameCandidate('zhangsan@example.com', 2)
  assert.ok(unique.length <= 20)
  assert.ok(unique.startsWith('zhangsan'))
  assert.notEqual(unique, base)
})
