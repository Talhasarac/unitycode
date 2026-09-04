import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { modeStateFile, readLastMode, validUnityCodeMode, writeLastMode } from "../plugins/unitycode-mode-state.mjs"

const temporary = await mkdtemp(path.join(os.tmpdir(), "unitycode-mode-state-"))
try {
  assert.equal(await readLastMode(temporary), "unity")
  assert.equal(await writeLastMode(temporary, "simplemode"), true)
  assert.equal(await readLastMode(temporary), "simplemode")
  assert.equal(validUnityCodeMode("dumpmode\n"), "dumpmode")
  assert.equal(validUnityCodeMode("plan\n"), "plan")
  assert.equal(await writeLastMode(temporary, "not-an-agent"), false)
  assert.equal(await readLastMode(temporary), "simplemode")
  await writeFile(modeStateFile(temporary), "../../unsafe\n")
  assert.equal(await readLastMode(temporary), "unity")
  console.log("mode-state: ok")
} finally {
  await rm(temporary, { recursive: true, force: true })
}
