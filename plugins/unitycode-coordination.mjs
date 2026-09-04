import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

export const DEFAULT_LEASE_MS = 30_000
const LOCKS_DIRECTORY = "Locks"
const GUARDS_DIRECTORY = "Guards"
const AGENTS_DIRECTORY = "Agents"
const MESSAGES_DIRECTORY = "Messages"
const GUARD_STALE_MS = 30_000
const GUARD_RETRY_MS = 10
const GUARD_ATTEMPTS = 500
const MESSAGE_TTL_MS = 24 * 60 * 60 * 1_000

export function coordinationDirectory(projectRoot) {
  return path.join(projectRoot, "Library", "UnityCode", "Coordination")
}

function storagePath(projectRoot, name) {
  return path.join(coordinationDirectory(projectRoot), name)
}

function stableName(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32)
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return undefined
    throw error
  }
}

async function writeJson(file, value) {
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 })
  try {
    await rename(temporary, file)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

async function fileHash(file) {
  try {
    return createHash("sha256").update(await readFile(file)).digest("hex")
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

function normalizeAssetPath(projectRoot, requestedPath) {
  const absolute = path.resolve(projectRoot, requestedPath)
  const relative = path.relative(projectRoot, absolute)
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Coordination paths must be inside the Unity project: ${requestedPath}`)
  }

  const withoutMeta = relative.toLowerCase().endsWith(".meta") ? relative.slice(0, -5) : relative
  const displayPath = withoutMeta.split(path.sep).join("/")
  const identityPath = process.platform === "linux" ? displayPath : displayPath.toLowerCase()
  return { absolutePath: path.join(projectRoot, withoutMeta), displayPath, resource: `asset:${identityPath}` }
}

export function expandResources(projectRoot, requestedResources) {
  const resources = new Map()

  for (const requested of requestedResources) {
    if (requested === "@csharp") {
      resources.set("global:csharp-write", { resource: "global:csharp-write", displayPath: "@csharp" })
      continue
    }
    if (requested === "@unity-editor") {
      resources.set("global:unity-editor-write", {
        resource: "global:unity-editor-write",
        displayPath: "@unity-editor",
      })
      continue
    }

    const asset = normalizeAssetPath(projectRoot, requested)
    resources.set(asset.resource, asset)
    const extension = path.extname(asset.displayPath).toLowerCase()
    if (extension === ".cs") {
      resources.set("global:csharp-write", { resource: "global:csharp-write", displayPath: "@csharp" })
      resources.set("global:unity-editor-write", {
        resource: "global:unity-editor-write",
        displayPath: "@unity-editor",
      })
    }
    if (extension === ".prefab") {
      resources.set("global:unity-editor-write", {
        resource: "global:unity-editor-write",
        displayPath: "@unity-editor",
      })
    }
  }

  return [...resources.values()].sort((a, b) => a.resource.localeCompare(b.resource))
}

function lockDirectory(projectRoot, resource) {
  return path.join(storagePath(projectRoot, LOCKS_DIRECTORY), stableName(resource))
}

function guardDirectory(projectRoot, resource) {
  return path.join(storagePath(projectRoot, GUARDS_DIRECTORY), stableName(resource))
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function withResourceGuard(projectRoot, resource, action) {
  const guardsRoot = storagePath(projectRoot, GUARDS_DIRECTORY)
  await mkdir(guardsRoot, { recursive: true })
  const guard = guardDirectory(projectRoot, resource)

  for (let attempt = 0; attempt < GUARD_ATTEMPTS; attempt += 1) {
    try {
      await mkdir(guard)
    } catch (error) {
      if (error?.code !== "EEXIST") throw error
      try {
        if (Date.now() - (await stat(guard)).mtimeMs > GUARD_STALE_MS) {
          const staleGuard = `${guard}.stale-${randomUUID()}`
          await rename(guard, staleGuard)
          await rm(staleGuard, { recursive: true, force: true })
          continue
        }
      } catch (guardError) {
        if (guardError?.code === "ENOENT") continue
        throw guardError
      }
      await delay(GUARD_RETRY_MS)
      continue
    }

    try {
      return await action()
    } finally {
      await rm(guard, { recursive: true, force: true })
    }
  }

  throw new Error(`Coordination state is busy for ${resource}; retry shortly`)
}

async function readOwner(lockDir) {
  return readJson(path.join(lockDir, "owner.json"))
}

async function lockAgeReference(lockDir, owner) {
  if (Number.isFinite(Number(owner?.expiresAt))) return Number(owner.expiresAt)
  try {
    return (await stat(lockDir)).mtimeMs + DEFAULT_LEASE_MS
  } catch (error) {
    if (error?.code === "ENOENT") return 0
    throw error
  }
}

async function removeOwnedLock(projectRoot, resource, sessionID, leaseID) {
  return withResourceGuard(projectRoot, resource, async () => {
    const lockDir = lockDirectory(projectRoot, resource)
    const owner = await readOwner(lockDir)
    if (!owner || owner.sessionID !== sessionID || owner.leaseID !== leaseID) return false
    await rm(lockDir, { recursive: true, force: true })
    return true
  })
}

async function acquireOne(projectRoot, descriptor, identity, intent, now, leaseMs) {
  return withResourceGuard(projectRoot, descriptor.resource, async () => {
    const locksRoot = storagePath(projectRoot, LOCKS_DIRECTORY)
    await mkdir(locksRoot, { recursive: true })
    const lockDir = lockDirectory(projectRoot, descriptor.resource)
    let owner = await readOwner(lockDir)
    if (owner?.sessionID === identity.sessionID) {
      owner.agent = identity.agent
      owner.intent = intent
      owner.heartbeatAt = now
      owner.expiresAt = now + leaseMs
      await writeJson(path.join(lockDir, "owner.json"), owner)
      return { ok: true, owner, created: false }
    }

    try {
      const expiry = await lockAgeReference(lockDir, owner)
      if (expiry > now) return { ok: false, owner }
      if (owner || expiry > 0) await rm(lockDir, { recursive: true, force: true })
      await mkdir(lockDir)
    } catch (error) {
      if (error?.code !== "EEXIST") throw error
      owner = await readOwner(lockDir)
      return { ok: false, owner }
    }

    const leaseID = randomUUID()
    owner = {
      version: 1,
      resource: descriptor.resource,
      path: descriptor.displayPath,
      sessionID: identity.sessionID,
      agent: identity.agent,
      intent,
      leaseID,
      acquiredAt: now,
      heartbeatAt: now,
      expiresAt: now + leaseMs,
      baseHash: descriptor.absolutePath ? await fileHash(descriptor.absolutePath) : null,
    }
    try {
      await writeJson(path.join(lockDir, "owner.json"), owner)
      return { ok: true, owner, created: true }
    } catch (error) {
      await rm(lockDir, { recursive: true, force: true })
      throw error
    }
  })
}

export async function claimResources(
  projectRoot,
  requestedResources,
  identity,
  intent,
  now = Date.now(),
  leaseMs = DEFAULT_LEASE_MS,
) {
  const descriptors = expandResources(projectRoot, requestedResources)
  if (descriptors.length === 0) throw new Error("At least one resource is required")

  const acquired = []
  for (const descriptor of descriptors) {
    const result = await acquireOne(projectRoot, descriptor, identity, intent, now, leaseMs)
    if (!result.ok) {
      await Promise.all(
        acquired
          .filter((item) => item.created)
          .map((item) => removeOwnedLock(projectRoot, item.owner.resource, identity.sessionID, item.owner.leaseID)),
      )
      return {
        ok: false,
        conflict: result.owner ?? { resource: descriptor.resource, path: descriptor.displayPath, agent: "unknown" },
      }
    }
    acquired.push(result)
  }

  return { ok: true, locks: acquired.map((item) => item.owner) }
}

export async function listLocks(projectRoot, now = Date.now(), includeExpired = false) {
  const locksRoot = storagePath(projectRoot, LOCKS_DIRECTORY)
  let entries
  try {
    entries = await readdir(locksRoot, { withFileTypes: true })
  } catch (error) {
    if (error?.code === "ENOENT") return []
    throw error
  }

  const owners = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.includes(".stale-"))
      .map(async (entry) => {
        const lockDir = path.join(locksRoot, entry.name)
        const owner = await readOwner(lockDir)
        const expiry = await lockAgeReference(lockDir, owner)
        if (owner && (includeExpired || expiry > now)) return owner
        return undefined
      }),
  )
  return owners.filter(Boolean)
}

export async function verifyResourcesOwned(projectRoot, sessionID, requestedResources, now = Date.now(), checkHash = true) {
  const descriptors = expandResources(projectRoot, requestedResources)
  const missing = []
  const changed = []

  for (const descriptor of descriptors) {
    const owner = await readOwner(lockDirectory(projectRoot, descriptor.resource))
    if (!owner || owner.sessionID !== sessionID || Number(owner.expiresAt) <= now) {
      missing.push(descriptor.displayPath)
      continue
    }
    if (checkHash && descriptor.absolutePath) {
      const currentHash = await fileHash(descriptor.absolutePath)
      if (currentHash !== owner.baseHash) changed.push(descriptor.displayPath)
    }
  }
  return { ok: missing.length === 0 && changed.length === 0, missing, changed }
}

export async function updateOwnedHashes(projectRoot, sessionID, requestedResources) {
  for (const descriptor of expandResources(projectRoot, requestedResources)) {
    if (!descriptor.absolutePath) continue
    const baseHash = await fileHash(descriptor.absolutePath)
    await withResourceGuard(projectRoot, descriptor.resource, async () => {
      const lockDir = lockDirectory(projectRoot, descriptor.resource)
      const owner = await readOwner(lockDir)
      if (!owner || owner.sessionID !== sessionID) return
      owner.baseHash = baseHash
      await writeJson(path.join(lockDir, "owner.json"), owner)
    })
  }
}

export async function renewSession(projectRoot, sessionID, now = Date.now(), leaseMs = DEFAULT_LEASE_MS) {
  const locks = await listLocks(projectRoot, now)
  await Promise.all(
    locks
      .filter((owner) => owner.sessionID === sessionID)
      .map(async (owner) => {
        await withResourceGuard(projectRoot, owner.resource, async () => {
          const lockDir = lockDirectory(projectRoot, owner.resource)
          const current = await readOwner(lockDir)
          if (!current || current.sessionID !== sessionID || current.leaseID !== owner.leaseID) return
          current.heartbeatAt = now
          current.expiresAt = now + leaseMs
          await writeJson(path.join(lockDir, "owner.json"), current)
        })
      }),
  )
}

export async function releaseSession(projectRoot, sessionID) {
  const locks = await listLocks(projectRoot, Date.now(), true)
  const released = []
  for (const owner of locks.filter((item) => item.sessionID === sessionID)) {
    if (await removeOwnedLock(projectRoot, owner.resource, sessionID, owner.leaseID)) released.push(owner.path)
  }
  return released
}

function agentFile(projectRoot, sessionID) {
  return path.join(storagePath(projectRoot, AGENTS_DIRECTORY), `${stableName(sessionID)}.json`)
}

export async function touchAgent(projectRoot, identity, status = "active", now = Date.now()) {
  const directory = storagePath(projectRoot, AGENTS_DIRECTORY)
  await mkdir(directory, { recursive: true })
  const file = agentFile(projectRoot, identity.sessionID)
  const previous = await readJson(file)
  await writeJson(file, {
    version: 1,
    sessionID: identity.sessionID,
    agent: identity.agent || previous?.agent || "unity",
    status: status === "waiting" ? "waiting" : "active",
    startedAt: previous?.startedAt ?? now,
    heartbeatAt: now,
    expiresAt: now + DEFAULT_LEASE_MS,
  })
}

export async function listAgents(projectRoot, now = Date.now()) {
  const directory = storagePath(projectRoot, AGENTS_DIRECTORY)
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === "ENOENT") return []
    throw error
  }

  const agents = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const file = path.join(directory, entry.name)
        const agent = await readJson(file)
        if (agent && Number(agent.expiresAt) > now) return agent
        await unlink(file).catch(() => undefined)
        return undefined
      }),
  )
  return agents.filter(Boolean)
}

export async function removeAgent(projectRoot, sessionID) {
  await unlink(agentFile(projectRoot, sessionID)).catch(() => undefined)
}

export async function postMessage(projectRoot, from, to, message, now = Date.now()) {
  const directory = storagePath(projectRoot, MESSAGES_DIRECTORY)
  await mkdir(directory, { recursive: true })
  const record = { version: 1, id: randomUUID(), from, to: to || "all", message, createdAt: now }
  await writeJson(path.join(directory, `${now}-${record.id}.json`), record)
  return record
}

export async function readInbox(projectRoot, sessionID, limit = 20, now = Date.now()) {
  const directory = storagePath(projectRoot, MESSAGES_DIRECTORY)
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === "ENOENT") return []
    throw error
  }

  const messages = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const file = path.join(directory, entry.name)
        const message = await readJson(file)
        if (!message || !Number.isFinite(Number(message.createdAt)) || now - Number(message.createdAt) > MESSAGE_TTL_MS) {
          await unlink(file).catch(() => undefined)
          return undefined
        }
        return message
      }),
  )
  return messages
    .filter((message) => message && (message.to === "all" || message.to === sessionID))
    .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
    .slice(0, limit)
}
