/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule, TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import {
  createPresenceId,
  presenceDirectory,
  removePresence,
  summarizePresence,
  writePresence,
} from "./unitycode-presence.mjs"
import { writeLastMode } from "./unitycode-mode-state.mjs"

const HEARTBEAT_INTERVAL_MS = 2_000
const STALE_AFTER_MS = 10_000
const PRESENCE_LABEL_KEY = "unitycode.presence.label"

const tui: TuiPlugin = async (api) => {
  const projectRoot = api.state.path.worktree || api.state.path.directory || process.cwd()
  const directory = presenceDirectory(projectRoot)
  const presenceId = createPresenceId()
  const startedAt = Date.now()
  let disposed = false
  let refreshing = false

  const currentStatus = () => {
    const route = api.route.current
    if (route.name !== "session") return "waiting"

    const sessionID = route.params.sessionID
    if (api.state.session.permission(sessionID).length > 0) return "waiting"
    if (api.state.session.question(sessionID).length > 0) return "waiting"
    const status = api.state.session.status(sessionID)?.type
    return status === "busy" || status === "retry" ? "active" : "waiting"
  }

  const refreshPresence = async () => {
    if (disposed || refreshing) return
    refreshing = true
    try {
      await writePresence(directory, presenceId, currentStatus(), startedAt)
      const summary = await summarizePresence(directory, Date.now(), STALE_AFTER_MS)
      const label = `agents ${summary.total} · active ${summary.active} · waiting ${summary.waiting}`
      if (api.kv.get(PRESENCE_LABEL_KEY) !== label) api.kv.set(PRESENCE_LABEL_KEY, label)
    } catch {
      if (api.kv.get(PRESENCE_LABEL_KEY) !== "agents unavailable") {
        api.kv.set(PRESENCE_LABEL_KEY, "agents unavailable")
      }
    } finally {
      refreshing = false
    }
  }

  const branding: TuiSlotPlugin = {
    slots: {
      home_logo(ctx) {
        const theme = ctx.theme.current
        const art = [
          "█ █ █▄ █ █ ▀█▀ █ █ █▀▀ █▀█ █▀▄ █▀▀",
          "█▄█ █ ▀█ █  █  ▀▄▀ █▄▄ █▄█ █▄▀ ██▄",
        ]

        return (
          <box flexDirection="column" alignItems="center">
            {art.map((line) => <text fg={theme.primary}>{line}</text>)}
            <text fg={theme.textMuted}>unitycode · Unity + OpenCode</text>
          </box>
        )
      },
      app_bottom(ctx) {
        return (
          <box height={1} flexShrink={0} flexDirection="row" paddingLeft={1}>
            <text fg={ctx.theme.current.success}>● </text>
            <text fg={ctx.theme.current.textMuted}>
              {api.kv.get(PRESENCE_LABEL_KEY, "agents 1 · active 0 · waiting 1")}
            </text>
          </box>
        )
      },
    },
  }

  api.slots.register(branding)
  await refreshPresence()
  const interval = setInterval(() => void refreshPresence(), HEARTBEAT_INTERVAL_MS)
  const offSessionStatus = api.event.on("session.status", () => void refreshPresence())
  const offSessionIdle = api.event.on("session.idle", () => void refreshPresence())
  const offAgentSwitch = api.event.on("session.next.agent.switched", (event) => {
    void writeLastMode(projectRoot, event.properties.agent)
  })

  api.lifecycle.onDispose(async () => {
    disposed = true
    clearInterval(interval)
    offSessionStatus()
    offSessionIdle()
    offAgentSwitch()
    await removePresence(directory, presenceId)
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "unitycode.logo",
  tui,
}

export default plugin
