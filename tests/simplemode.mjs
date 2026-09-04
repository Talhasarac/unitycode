import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import coordinator from "../plugins/unitycode-coordinator.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const result = spawnSync("opencode", ["debug", "agent", "simplemode"], {
  cwd: root,
  env: {
    ...process.env,
    OPENCODE_CONFIG: path.join(root, "opencode.jsonc"),
    OPENCODE_CONFIG_DIR: root,
    UNITY_MCP_URL: process.env.UNITY_MCP_URL || "http://127.0.0.1:8080/mcp",
  },
  encoding: "utf8",
})

assert.equal(result.status, 0, result.stderr)
const agent = JSON.parse(result.stdout)
const expected = {
  read: true,
  glob: true,
  grep: true,
  edit: true,
  write: true,
  unitycode_coordination: true,
  bash: false,
  task: false,
  skill: false,
  webfetch: false,
  todowrite: false,
}
for (const [name, enabled] of Object.entries(expected)) {
  assert.equal(agent.tools[name], enabled, `${name} should be ${enabled}`)
}
assert.match(agent.prompt, /UnityCode Simple Mode/)

const configResult = spawnSync("opencode", ["debug", "config"], {
  cwd: root,
  env: {
    ...process.env,
    OPENCODE_CONFIG: path.join(root, "opencode.jsonc"),
    OPENCODE_CONFIG_DIR: root,
    UNITY_MCP_URL: process.env.UNITY_MCP_URL || "http://127.0.0.1:8080/mcp",
  },
  encoding: "utf8",
})
assert.equal(configResult.status, 0, configResult.stderr)
const config = JSON.parse(configResult.stdout)
assert.equal(config.command.simplemode.agent, "simplemode")

const temporary = await mkdtemp(path.join(os.tmpdir(), "unitycode-simplemode-"))
try {
  const plugin = await coordinator({ directory: temporary, worktree: temporary })
  const transform = plugin["experimental.chat.system.transform"]
  assert.equal(typeof transform, "function")

  const output = { system: ["base system", "agent instructions"] }
  await transform({ sessionID: "simplemode-test", model: {} }, output)
  assert.equal(output.system.length, 1, "Qwen-compatible requests must contain one system message")
  assert.match(output.system[0], /base system/)
  assert.match(output.system[0], /agent instructions/)
  assert.match(output.system[0], /UnityCode live coordination snapshot/)

  await plugin.dispose?.()
} finally {
  await rm(temporary, { recursive: true, force: true })
}

console.log("simplemode: ok")
