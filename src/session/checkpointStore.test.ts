import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AtlasCheckpointStore, checkpointIdFor } from './checkpointStore'
import { SessionStore } from './sessionStore'
import type { CheckpointData } from 'agenthood/dist/checkpoint/RunCheckpoint.js'

function checkpoint(id: string, step: number): CheckpointData {
  return {
    id,
    member: 'the-builder',
    task: 'deploy',
    step,
    messages: [],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    model: 'mock',
    activatedSkills: [],
    status: 'running',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

test('checkpointIdFor delegates to the runner generateId', () => {
  assert.equal(checkpointIdFor('cor-1'), 'cor-1')
})

test('sync mirror: save/load/updateStatus without touching the backend', async () => {
  const backend = new SessionStore()
  const store = new AtlasCheckpointStore(backend)
  assert.equal(store.load('cor-1'), undefined)

  store.save(checkpoint('cor-1', 2))
  assert.equal(store.load('cor-1')?.step, 2)

  store.updateStatus('cor-1', 'completed')
  assert.equal(store.load('cor-1')?.status, 'completed')

  // unknown id is a no-op, and nothing reached the backend
  store.updateStatus('cor-missing', 'failed')
  assert.equal(await backend.loadCheckpoint('cor-1'), null)
})

test('persist/hydrate round-trips through the backend', async () => {
  const backend = new SessionStore()
  const store = new AtlasCheckpointStore(backend)
  store.save(checkpoint('cor-1', 4))

  await store.persist('cor-1', 'ses-1')
  assert.deepEqual(await backend.loadCheckpoint('cor-1'), {
    sessionId: 'ses-1',
    data: JSON.stringify(checkpoint('cor-1', 4)),
  })

  // a fresh mirror hydrates from the row
  const revived = new AtlasCheckpointStore(backend)
  assert.equal(await revived.hydrate('cor-1'), true)
  assert.equal(revived.load('cor-1')?.step, 4)

  assert.equal(await revived.hydrate('cor-missing'), false)
})

test('persist of an unmirrored id is a no-op', async () => {
  const backend = new SessionStore()
  const store = new AtlasCheckpointStore(backend)
  await store.persist('cor-missing', 'ses-1')
  assert.equal(await backend.loadCheckpoint('cor-missing'), null)
})

test('drop clears the mirror and the row', async () => {
  const backend = new SessionStore()
  const store = new AtlasCheckpointStore(backend)
  store.save(checkpoint('cor-1', 1))
  await store.persist('cor-1', 'ses-1')

  await store.drop('cor-1')
  assert.equal(store.load('cor-1'), undefined)
  assert.equal(await backend.loadCheckpoint('cor-1'), null)
})
