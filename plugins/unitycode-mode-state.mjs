import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"

export const UNITYCODE_MODES = new Set(["unity", "unity-full", "simplemode", "dumpmode", "build", "plan"])

export function modeStateFile(projectRoot) {
  return path.join(projectRoot, "Library", "UnityCode", "last-mode")
}

export function validUnityCodeMode(value, fallback = "unity") {
  const mode = String(value ?? "").trim()
  return UNITYCODE_MODES.has(mode) ? mode : fallback
}

export async function readLastMode(projectRoot, fallback = "unity") {
  try {
    return validUnityCodeMode(await readFile(modeStateFile(projectRoot), "utf8"), fallback)
  } catch (error) {
    if (error?.code === "ENOENT") return fallback
    throw error
  }
}

export async function writeLastMode(projectRoot, mode) {
  const valid = validUnityCodeMode(mode, "")
  if (!valid) return false
  const file = modeStateFile(projectRoot)
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`
  await writeFile(temporary, `${valid}\n`, { encoding: "utf8", mode: 0o600 })
  try {
    await rename(temporary, file)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
  return true
}
