import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import coordinator, { shortConversationTitle } from "../plugins/unitycode-coordinator.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
assert.equal(shortConversationTitle([{ type: "text", text: "  hello   wonderful world  " }]), "hello wond")
assert.equal(shortConversationTitle([{ type: "text", text: '"abcdefghijk title"' }]), "abcdefghij")
assert.equal(
  shortConversationTitle([
    { type: "text", text: "inspect " },
    { type: "file", source: { text: { value: "@Assets/vacumMachine.cs" } } },
    { type: "text", text: " code" },
  ]),
  "inspect @A",
)
const environment = {
  ...process.env,
  OPENCODE_CONFIG: path.join(root, "opencode.jsonc"),
  OPENCODE_CONFIG_DIR: root,
  UNITY_MCP_URL: process.env.UNITY_MCP_URL || "http://127.0.0.1:8080/mcp",
}

const result = spawnSync("opencode", ["debug", "agent", "dumpmode"], {
  cwd: root,
  env: environment,
  encoding: "utf8",
})
assert.equal(result.status, 0, result.stderr)

const agent = JSON.parse(result.stdout)
const enabledTools = Object.entries(agent.tools)
  .filter(([, enabled]) => enabled)
  .map(([name]) => name)
  .sort()
assert.deepEqual(enabledTools, ["edit", "grep", "unitycode_coordination", "write"])
assert.equal(agent.tools.unitycode_coordination, true)
assert.notEqual(agent.tools.list_mcp_resource_templates, true)
assert.notEqual(agent.tools.list_mcp_resources, true)
assert.notEqual(agent.tools.read_mcp_resource, true)
assert.equal(Object.entries(agent.tools).some(([name, enabled]) => name.startsWith("unity_") && enabled), false)
assert.match(agent.prompt, /UnityCode Dump Mode/)

const configResult = spawnSync("opencode", ["debug", "config"], {
  cwd: root,
  env: environment,
  encoding: "utf8",
})
assert.equal(configResult.status, 0, configResult.stderr)
const config = JSON.parse(configResult.stdout)
assert.equal(config.command.dumpmode.agent, "dumpmode")

const temporary = await mkdtemp(path.join(os.tmpdir(), "unitycode-dumpmode-"))
const capturedRequests = []
const server = http.createServer((request, response) => {
  let raw = ""
  request.on("data", (chunk) => (raw += chunk))
  request.on("end", () => {
    capturedRequests.push(JSON.parse(raw))
    const base = { id: "chatcmpl-dumpmode", object: "chat.completion.chunk", created: 1, model: "probe" }
    response.writeHead(200, { "content-type": "text/event-stream" })
    response.write(
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "hello" }, finish_reason: null }] })}\n\n`,
    )
    response.write(
      `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
    )
    response.end("data: [DONE]\n\n")
  })
})

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port
  const inlineConfig = {
    provider: {
      probe: {
        npm: "@ai-sdk/openai-compatible",
        name: "Dump Mode Probe",
        options: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: "probe" },
        models: { probe: { name: "Probe", limit: { context: 32_768, output: 1_024 } } },
      },
    },
    mcp: { unity: { enabled: false } },
  }
  const child = spawn(
    "opencode",
    ["run", "--agent", "dumpmode", "--model", "probe/probe", "hello"],
    {
      cwd: temporary,
      env: { ...environment, OPENCODE_CONFIG_CONTENT: JSON.stringify(inlineConfig) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  let stderr = ""
  child.stderr.on("data", (chunk) => (stderr += chunk))
  const exitCode = await new Promise((resolve) => child.on("close", resolve))
  assert.equal(exitCode, 0, stderr)

  assert.equal(capturedRequests.length, 1, "Dump Mode must not make a separate title-model request")
  const capturedRequest = capturedRequests[0]
  assert.equal(capturedRequest.messages.length, 2)
  assert.equal(capturedRequest.messages[0].role, "system")
  assert.match(capturedRequest.messages[0].content, /UnityCode Dump Mode/)
  assert.deepEqual(
    capturedRequest.tools.map((entry) => entry.function.name).sort(),
    ["edit", "grep", "unitycode_coordination", "write"],
  )
  const inputCharacters = JSON.stringify({
    messages: capturedRequest.messages,
    tools: capturedRequest.tools,
  }).length
  assert.ok(inputCharacters <= 6_000, `hello request is too large: ${inputCharacters} characters`)

  const simpleChild = spawn(
    "opencode",
    ["run", "--agent", "simplemode", "--model", "probe/probe", "abcdefghijk simple title"],
    {
      cwd: temporary,
      env: { ...environment, OPENCODE_CONFIG_CONTENT: JSON.stringify(inlineConfig) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  let simpleStderr = ""
  simpleChild.stderr.on("data", (chunk) => (simpleStderr += chunk))
  const simpleExitCode = await new Promise((resolve) => simpleChild.on("close", resolve))
  assert.equal(simpleExitCode, 0, simpleStderr)
  assert.equal(capturedRequests.length, 2, "Simple Mode must not make a separate title-model request")

  const plugin = await coordinator({ directory: temporary, worktree: temporary })
  await plugin["chat.message"]({ sessionID: "dumpmode-guard", agent: "dumpmode" })
  await assert.rejects(
    plugin["tool.execute.before"](
      { tool: "edit", sessionID: "dumpmode-guard", callID: "guard-test" },
      { args: { filePath: "README.md", oldString: "old", newString: "new" } },
    ),
    /only modify \.cs files/,
  )
  await plugin.dispose?.()
} finally {
  server.close()
  await rm(temporary, { recursive: true, force: true })
}

console.log("dumpmode: ok")
