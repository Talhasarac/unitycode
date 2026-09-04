import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import contextLogger from "../plugins/unitycode-context-logger.ts"

const temporary = await mkdtemp(path.join(os.tmpdir(), "unitycode-context-log-"))
const filename = path.join(temporary, "Library", "UnityCode", "context-log.sqlite3")

try {
  const plugin = await contextLogger(
    {
      directory: temporary,
      worktree: temporary,
      client: {
        session: {
          messages: async () => ({
            data: [{ info: { sessionID: "session-1", role: "user" }, parts: [{ type: "text", text: "hello" }] }],
          }),
        },
      },
    },
    { databasePath: filename },
  )

  await plugin["chat.message"](
    {
      sessionID: "session-1",
      messageID: "message-user",
      agent: "dumpmode",
      model: { providerID: "probe", modelID: "model" },
    },
    { message: { role: "user" }, parts: [{ type: "text", text: "hello", apiKey: "must-not-leak" }] },
  )
  await plugin["experimental.chat.messages.transform"]({}, {
    messages: [{ info: { sessionID: "session-1", role: "user" }, parts: [{ type: "text", text: "hello" }] }],
  })
  await plugin["experimental.chat.system.transform"](
    { sessionID: "session-1", model: { providerID: "probe", id: "model" } },
    { system: ["system context"] },
  )
  await plugin["chat.params"](
    {
      sessionID: "session-1",
      agent: "dumpmode",
      model: { providerID: "probe", id: "model" },
      message: { id: "message-user" },
    },
    { temperature: 0.2, topP: 1, topK: 0, maxOutputTokens: 100, options: {} },
  )
  await plugin["tool.definition"](
    { toolID: "unity_read_console" },
    { description: "Read console", parameters: { type: "object" } },
  )
  await plugin["tool.execute.before"](
    { tool: "unity_read_console", sessionID: "session-1", callID: "call-1" },
    { args: { action: "get" } },
  )
  await plugin["tool.execute.after"](
    { tool: "unity_read_console", sessionID: "session-1", callID: "call-1", args: { action: "get" } },
    { title: "Console", output: "no errors", metadata: {} },
  )
  await plugin["experimental.text.complete"](
    { sessionID: "session-1", messageID: "message-assistant", partID: "part-1" },
    { text: "done" },
  )
  await plugin.event({
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "message-assistant",
          sessionID: "session-1",
          role: "assistant",
          agent: "dumpmode",
          providerID: "probe",
          modelID: "model",
        },
      },
    },
  })
  await plugin.event({ event: { type: "session.idle", properties: { sessionID: "session-1" } } })

  const secondPlugin = await contextLogger(
    { directory: temporary, worktree: temporary },
    { databasePath: filename },
  )
  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      (index % 2 === 0 ? plugin : secondPlugin)["chat.message"](
        { sessionID: `parallel-${index}`, messageID: `message-${index}`, agent: "dumpmode" },
        { message: { role: "user" }, parts: [{ type: "text", text: `parallel ${index}` }] },
      ),
    ),
  )
  await secondPlugin.dispose()
  await plugin.dispose()

  const database = new DatabaseSync(filename, { readOnly: true })
  const rows = database.prepare("SELECT * FROM context_events ORDER BY id").all()
  database.close()

  assert.deepEqual(
    [...new Set(rows.map((row) => row.event_type))].sort(),
    [
      "assistant_message",
      "assistant_text",
      "message_context",
      "request_parameters",
      "session_snapshot",
      "system_context",
      "tool_call",
      "tool_definition",
      "tool_result",
      "user_message",
    ].sort(),
  )
  assert.equal(rows.find((row) => row.event_type === "tool_call").channel, "mcp")
  assert.equal(rows.every((row) => row.project_root === temporary), true)
  assert.equal(rows.filter((row) => row.event_type === "user_message").length, 21)
  assert.equal(rows.some((row) => row.payload_json.includes("must-not-leak")), false)
  assert.equal(rows.some((row) => row.payload_json.includes("[REDACTED]")), true)
  console.log("context_logger: ok")
} finally {
  await rm(temporary, { recursive: true, force: true })
}
