import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises"
import { hostname } from "node:os"
import path from "node:path"

const PRESENCE_SUFFIX = ".json"

export function presenceDirectory(projectRoot) {
  return path.join(projectRoot, "Library", "UnityCode", "Presence")
}

export function createPresenceId(pid = process.pid, host = hostname()) {
  const safeHost = host.replace(/[^a-zA-Z0-9._-]/g, "-")
  return `${safeHost}-${pid}-${randomUUID()}`
}

export async function writePresence(directory, id, status, startedAt, now = Date.now()) {
  await mkdir(directory, { recursive: true })
  const record = {
    version: 1,
    pid: process.pid,
    status: status === "active" ? "active" : "waiting",
    startedAt,
    heartbeatAt: now,
  }
  await writeFile(path.join(directory, `${id}${PRESENCE_SUFFIX}`), `${JSON.stringify(record)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })
}

export async function summarizePresence(directory, now = Date.now(), staleAfterMs = 10_000) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === "ENOENT") return { total: 0, active: 0, waiting: 0 }
    throw error
  }

  const records = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(PRESENCE_SUFFIX))
      .map(async (entry) => {
        const file = path.join(directory, entry.name)
        let heartbeatAt
        let status = "waiting"

        try {
          const record = JSON.parse(await readFile(file, "utf8"))
          heartbeatAt = Number(record.heartbeatAt)
          status = record.status === "active" ? "active" : "waiting"
        } catch {
          try {
            heartbeatAt = (await stat(file)).mtimeMs
          } catch (error) {
            if (error?.code === "ENOENT") return undefined
            throw error
          }
        }

        if (!Number.isFinite(heartbeatAt) || now - heartbeatAt > staleAfterMs) {
          await unlink(file).catch(() => undefined)
          return undefined
        }
        return status
      }),
  )

  const live = records.filter(Boolean)
  const active = live.filter((status) => status === "active").length
  return { total: live.length, active, waiting: live.length - active }
}

export async function removePresence(directory, id) {
  await unlink(path.join(directory, `${id}${PRESENCE_SUFFIX}`)).catch(() => undefined)
}
