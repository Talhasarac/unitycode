import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  claimResources,
  expandResources,
  listAgents,
  listLocks,
  postMessage,
  readInbox,
  releaseSession,
  removeAgent,
  renewSession,
  touchAgent,
  updateOwnedHashes,
  verifyResourcesOwned,
} from "../plugins/unitycode-coordination.mjs"

const projectRoot = await mkdtemp(path.join(os.tmpdir(), "unitycode-coordination-"))
const alice = { sessionID: "session-alice", agent: "unity" }
const bob = { sessionID: "session-bob", agent: "unity-full" }

try {
  await mkdir(path.join(projectRoot, "Assets", "Scripts"), { recursive: true })
  await mkdir(path.join(projectRoot, "Assets", "Prefabs"), { recursive: true })
  const script = path.join(projectRoot, "Assets", "Scripts", "Player.cs")
  const prefab = path.join(projectRoot, "Assets", "Prefabs", "Player.prefab")
  await writeFile(script, "class Player {}\n")
  await writeFile(prefab, "%YAML 1.1\n")

  const expandedScript = expandResources(projectRoot, ["Assets/Scripts/Player.cs"])
  assert.deepEqual(
    expandedScript.map((item) => item.displayPath),
    ["Assets/Scripts/Player.cs", "@csharp", "@unity-editor"],
  )
  assert.throws(() => expandResources(projectRoot, ["../Outside.cs"]), /inside the Unity project/)

  const aliceClaim = await claimResources(
    projectRoot,
    ["Assets/Scripts/Player.cs"],
    alice,
    "Change movement",
    1_000,
    1_000,
  )
  assert.equal(aliceClaim.ok, true)
  assert.equal(aliceClaim.locks.length, 3)

  const bobConflict = await claimResources(
    projectRoot,
    ["Assets/Scripts/Player.cs"],
    bob,
    "Change health",
    1_100,
    1_000,
  )
  assert.equal(bobConflict.ok, false)
  assert.equal(bobConflict.conflict.sessionID, alice.sessionID)

  assert.deepEqual(await verifyResourcesOwned(projectRoot, alice.sessionID, ["Assets/Scripts/Player.cs"], 1_200), {
    ok: true,
    missing: [],
    changed: [],
  })
  await writeFile(script, "class Player { int Speed; }\n")
  const externalChange = await verifyResourcesOwned(projectRoot, alice.sessionID, ["Assets/Scripts/Player.cs"], 1_300)
  assert.equal(externalChange.ok, false)
  assert.deepEqual(externalChange.changed, ["Assets/Scripts/Player.cs"])
  await updateOwnedHashes(projectRoot, alice.sessionID, ["Assets/Scripts/Player.cs"])
  assert.equal((await verifyResourcesOwned(projectRoot, alice.sessionID, ["Assets/Scripts/Player.cs"], 1_400)).ok, true)

  assert.deepEqual((await listLocks(projectRoot, 1_500)).map((lock) => lock.path).sort(), [
    "@csharp",
    "@unity-editor",
    "Assets/Scripts/Player.cs",
  ])
  await releaseSession(projectRoot, alice.sessionID)

  const prefabClaim = await claimResources(
    projectRoot,
    ["Assets/Prefabs/Player.prefab"],
    alice,
    "Adjust collider",
    2_000,
    100,
  )
  assert.equal(prefabClaim.ok, true)
  const staleTakeover = await claimResources(
    projectRoot,
    ["Assets/Prefabs/Player.prefab"],
    bob,
    "Adjust renderer",
    2_101,
    1_000,
  )
  assert.equal(staleTakeover.ok, true)
  assert.equal((await verifyResourcesOwned(projectRoot, alice.sessionID, ["Assets/Prefabs/Player.prefab"], 2_102)).ok, false)
  assert.equal((await verifyResourcesOwned(projectRoot, bob.sessionID, ["Assets/Prefabs/Player.prefab"], 2_102)).ok, true)
  await releaseSession(projectRoot, bob.sessionID)

  const [raceA, raceB] = await Promise.all([
    claimResources(projectRoot, ["Assets/Scripts/Player.cs"], alice, "Race A", 3_000, 1_000),
    claimResources(projectRoot, ["Assets/Scripts/Player.cs"], bob, "Race B", 3_000, 1_000),
  ])
  assert.equal(Number(raceA.ok) + Number(raceB.ok), 1)
  await releaseSession(projectRoot, raceA.ok ? alice.sessionID : bob.sessionID)

  assert.equal(
    (await claimResources(projectRoot, ["Assets/Prefabs/Player.prefab"], alice, "Old lease", 6_000, 100)).ok,
    true,
  )
  const [, fencedTakeover] = await Promise.all([
    renewSession(projectRoot, alice.sessionID, 6_101, 1_000),
    claimResources(projectRoot, ["Assets/Prefabs/Player.prefab"], bob, "Fenced takeover", 6_101, 1_000),
  ])
  assert.equal(fencedTakeover.ok, true)
  assert.equal((await verifyResourcesOwned(projectRoot, bob.sessionID, ["Assets/Prefabs/Player.prefab"], 6_102)).ok, true)
  assert.equal((await verifyResourcesOwned(projectRoot, alice.sessionID, ["Assets/Prefabs/Player.prefab"], 6_102)).ok, false)
  await Promise.all([
    releaseSession(projectRoot, alice.sessionID),
    renewSession(projectRoot, bob.sessionID, 6_103, 1_000),
  ])
  assert.equal((await verifyResourcesOwned(projectRoot, bob.sessionID, ["Assets/Prefabs/Player.prefab"], 6_104)).ok, true)
  await releaseSession(projectRoot, bob.sessionID)

  await touchAgent(projectRoot, alice, "active", 4_000)
  await touchAgent(projectRoot, bob, "waiting", 4_100)
  const agents = await listAgents(projectRoot, 4_200)
  assert.equal(agents.length, 2)
  assert.deepEqual(agents.map((agent) => agent.status).sort(), ["active", "waiting"])
  await removeAgent(projectRoot, alice.sessionID)
  assert.equal((await listAgents(projectRoot, 4_200)).length, 1)

  const direct = await postMessage(projectRoot, alice.sessionID, bob.sessionID, "I released Player.cs", 5_000)
  await postMessage(projectRoot, alice.sessionID, "all", "Compiler is clear", 5_001)
  const inbox = await readInbox(projectRoot, bob.sessionID, 20, 5_100)
  assert.deepEqual(inbox.map((message) => message.id), [inbox[0].id, direct.id])
  assert.deepEqual(inbox.map((message) => message.message), ["Compiler is clear", "I released Player.cs"])

  console.log("coordination: ok")
} finally {
  await rm(projectRoot, { recursive: true, force: true })
}
