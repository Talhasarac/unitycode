import assert from "node:assert/strict"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  createPresenceId,
  presenceDirectory,
  removePresence,
  summarizePresence,
  writePresence,
} from "../plugins/unitycode-presence.mjs"

const root = await mkdtemp(path.join(tmpdir(), "unitycode-presence-test-"))

try {
  const directory = presenceDirectory(root)
  const activeId = createPresenceId(101, "test-host")
  const waitingId = createPresenceId(102, "test-host")
  const staleId = createPresenceId(103, "test-host")

  await writePresence(directory, activeId, "active", 900, 1_000)
  await writePresence(directory, waitingId, "waiting", 900, 1_000)
  await writePresence(directory, staleId, "waiting", 0, 100)

  assert.deepEqual(await summarizePresence(directory, 1_100, 500), {
    total: 2,
    active: 1,
    waiting: 1,
  })

  await removePresence(directory, activeId)
  assert.deepEqual(await summarizePresence(directory, 1_200, 500), {
    total: 1,
    active: 0,
    waiting: 1,
  })
  assert.equal((await readdir(directory)).length, 1)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log("presence_test: ok")

