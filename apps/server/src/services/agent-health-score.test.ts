import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreFromWorkRecords } from './agent-health-score'

test('scoreFromWorkRecords 无记录取中性 0.5', () => {
  assert.equal(scoreFromWorkRecords([]), 0.5)
})

test('scoreFromWorkRecords 按完成率计算', () => {
  const records = [
    { recordType: 'task_dispatched' },
    { recordType: 'task_completed' },
    { recordType: 'task_dispatched' },
  ]
  assert.equal(scoreFromWorkRecords(records), 0.5)
})

test('scoreFromWorkRecords 全完成 = 1，无派发有完成 = 1', () => {
  assert.equal(scoreFromWorkRecords([{ recordType: 'task_dispatched' }, { recordType: 'task_completed' }]), 1)
  assert.equal(scoreFromWorkRecords([{ recordType: 'task_completed' }]), 1)
})

test('scoreFromWorkRecords 只派发未完成 = 0', () => {
  assert.equal(scoreFromWorkRecords([{ recordType: 'task_dispatched' }]), 0)
})
