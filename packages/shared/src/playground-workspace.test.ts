import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isPlaygroundProjectId,
  isPlaygroundProject,
  PLAYGROUND_PROJECT_ID,
  PLAYGROUND_PROJECT_NAME,
} from './playground-workspace'

test('playground project id constants', () => {
  assert.equal(PLAYGROUND_PROJECT_ID, '__playground__')
  assert.equal(PLAYGROUND_PROJECT_NAME, '自由工作区')
  assert.equal(isPlaygroundProjectId('__playground__'), true)
  assert.equal(isPlaygroundProjectId('project-1'), false)
  assert.equal(isPlaygroundProjectId(null), false)
  assert.equal(isPlaygroundProjectId(undefined), false)
})

test('isPlaygroundProject accepts project-like objects', () => {
  assert.equal(isPlaygroundProject({ id: '__playground__' }), true)
  assert.equal(isPlaygroundProject({ id: 'project-1' }), false)
  assert.equal(isPlaygroundProject(null), false)
  assert.equal(isPlaygroundProject(undefined), false)
})
