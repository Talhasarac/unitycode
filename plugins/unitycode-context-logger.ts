import type { Plugin } from "@opencode-ai/plugin"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

type DatabaseAdapter = {
  exec(sql: string): void
  run(sql: string, values: unknown[]): void
  close(): void
}

type ContextEvent = {
  direction: "sent" | "received"
  channel: "model" | "tool" | "mcp" | "session"
  eventType: string
  sessionID?: string
  messageID?: string
  callID?: string
  agent?: string
  providerID?: string
  modelID?: string
  toolName?: string
  payload: unknown
}

const SENSITIVE_FIELD = /^(?:authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|password|secret|token|access[-_]?token|refresh[-_]?token)$/i
const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
export const CONTEXT_DATABASE_PATH = path.join(HARNESS_ROOT, "data", "context-log.sqlite3")

function safePayload(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value
  }
  if (typeof value === "bigint") return value.toString()
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack }
  if (Array.isArray(value)) return value.map((entry) => safePayload(entry, seen))
  if (typeof value !== "object") return String(value)
  if (seen.has(value)) return "[Circular]"
  seen.add(value)

  const sanitized: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    sanitized[key] = SENSITIVE_FIELD.test(key) ? "[REDACTED]" : safePayload(entry, seen)
  }
  seen.delete(value)
  return sanitized
}

function sessionFromMessages(messages: Array<{ info?: { sessionID?: string } }>) {
  return messages.findLast((message) => message.info?.sessionID)?.info?.sessionID
}

function toolChannel(toolName: string): "tool" | "mcp" {
  return toolName.startsWith("unity_") || /(?:^|_)mcp(?:_|$)/i.test(toolName) ? "mcp" : "tool"
}

async function openDatabase(filename: string): Promise<DatabaseAdapter> {
  try {
    const { DatabaseSync } = await import("node:sqlite")
    const database = new DatabaseSync(filename)
    return {
      exec: (sql) => database.exec(sql),
      run: (sql, values) => database.prepare(sql).run(...values),
      close: () => database.close(),
    }
  } catch {
    const { Database } = await import("bun:sqlite")
    const database = new Database(filename, { create: true })
    return {
      exec: (sql) => database.exec(sql),
      run: (sql, values) => database.query(sql).run(...values),
      close: () => database.close(),
    }
  }
}

const contextLogger: Plugin = async ({ client, directory, worktree }, options = {}) => {
  const projectRoot = worktree && worktree !== "/" ? worktree : directory
  const testDatabasePath = typeof options.databasePath === "string" ? options.databasePath : undefined
  const isolatedTestPath = process.env.NODE_ENV === "test" ? process.env.UNITYCODE_CONTEXT_DB_TEST : undefined
  const filename = path.resolve(testDatabasePath || isolatedTestPath || CONTEXT_DATABASE_PATH)
  let database: DatabaseAdapter | undefined
  let opening: Promise<DatabaseAdapter> | undefined

  const getDatabase = async () => {
    if (database) return database
    opening ??= (async () => {
      await mkdir(path.dirname(filename), { recursive: true })
      const opened = await openDatabase(filename)
      opened.exec("PRAGMA journal_mode=WAL;")
      opened.exec("PRAGMA synchronous=NORMAL;")
      opened.exec("PRAGMA busy_timeout=5000;")
      opened.exec(`
        CREATE TABLE IF NOT EXISTS context_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recorded_at TEXT NOT NULL,
          project_root TEXT NOT NULL,
          direction TEXT NOT NULL,
          channel TEXT NOT NULL,
          event_type TEXT NOT NULL,
          session_id TEXT,
          message_id TEXT,
          call_id TEXT,
          agent TEXT,
          provider_id TEXT,
          model_id TEXT,
          tool_name TEXT,
          payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS context_events_session_id ON context_events(session_id, id);
        CREATE INDEX IF NOT EXISTS context_events_project_root ON context_events(project_root, id);
        CREATE INDEX IF NOT EXISTS context_events_channel ON context_events(channel, event_type, id);
      `)
      database = opened
      return opened
    })()
    return opening
  }

  const record = async (event: ContextEvent) => {
    try {
      const target = await getDatabase()
      target.run(
        `INSERT INTO context_events (
          recorded_at, project_root, direction, channel, event_type, session_id, message_id, call_id,
          agent, provider_id, model_id, tool_name, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          new Date().toISOString(),
          projectRoot,
          event.direction,
          event.channel,
          event.eventType,
          event.sessionID ?? null,
          event.messageID ?? null,
          event.callID ?? null,
          event.agent ?? null,
          event.providerID ?? null,
          event.modelID ?? null,
          event.toolName ?? null,
          JSON.stringify(safePayload(event.payload)),
        ],
      )
    } catch {
      // Logging must never interrupt the user's model or Unity request.
    }
  }

  return {
    "chat.message": async (input, output) => {
      await record({
        direction: "sent",
        channel: "model",
        eventType: "user_message",
        sessionID: input.sessionID,
        messageID: input.messageID,
        agent: input.agent,
        providerID: input.model?.providerID,
        modelID: input.model?.modelID,
        payload: output,
      })
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      await record({
        direction: "sent",
        channel: "model",
        eventType: "message_context",
        sessionID: sessionFromMessages(output.messages),
        payload: output.messages,
      })
    },

    "experimental.chat.system.transform": async (input, output) => {
      await record({
        direction: "sent",
        channel: "model",
        eventType: "system_context",
        sessionID: input.sessionID,
        providerID: input.model?.providerID,
        modelID: input.model?.id,
        payload: output.system,
      })
    },

    "chat.params": async (input, output) => {
      await record({
        direction: "sent",
        channel: "model",
        eventType: "request_parameters",
        sessionID: input.sessionID,
        messageID: input.message?.id,
        agent: input.agent,
        providerID: input.model?.providerID,
        modelID: input.model?.id,
        payload: output,
      })
    },

    "tool.definition": async (input, output) => {
      await record({
        direction: "sent",
        channel: toolChannel(input.toolID),
        eventType: "tool_definition",
        toolName: input.toolID,
        payload: output,
      })
    },

    "tool.execute.before": async (input, output) => {
      await record({
        direction: "sent",
        channel: toolChannel(input.tool),
        eventType: "tool_call",
        sessionID: input.sessionID,
        callID: input.callID,
        toolName: input.tool,
        payload: output.args,
      })
    },

    "tool.execute.after": async (input, output) => {
      await record({
        direction: "received",
        channel: toolChannel(input.tool),
        eventType: "tool_result",
        sessionID: input.sessionID,
        callID: input.callID,
        toolName: input.tool,
        payload: { args: input.args, result: output },
      })
    },

    "experimental.text.complete": async (input, output) => {
      await record({
        direction: "received",
        channel: "model",
        eventType: "assistant_text",
        sessionID: input.sessionID,
        messageID: input.messageID,
        payload: { partID: input.partID, text: output.text },
      })
    },

    event: async ({ event }) => {
      const properties = (event as any).properties ?? (event as any).data ?? {}
      if (event.type === "message.updated" && properties.info?.role === "assistant") {
        await record({
          direction: "received",
          channel: "model",
          eventType: "assistant_message",
          sessionID: properties.info.sessionID,
          messageID: properties.info.id,
          agent: properties.info.agent,
          providerID: properties.info.providerID,
          modelID: properties.info.modelID,
          payload: properties.info,
        })
      }
      if (event.type === "session.idle" && properties.sessionID && client?.session) {
        try {
          const messages = await client.session.messages({
            path: { id: properties.sessionID },
            query: { directory: projectRoot },
          })
          await record({
            direction: "received",
            channel: "session",
            eventType: "session_snapshot",
            sessionID: properties.sessionID,
            payload: messages.data ?? [],
          })
        } catch {
          // The granular records above remain available if the snapshot API fails.
        }
      }
    },

    dispose: async () => {
      database?.close()
      database = undefined
    },
  }
}

export default contextLogger
