/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule, TuiSlotPlugin } from "@opencode-ai/plugin/tui"

const tui: TuiPlugin = async (api) => {
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
    },
  }

  api.slots.register(branding)
}

const plugin: TuiPluginModule & { id: string } = {
  id: "unitycode.logo",
  tui,
}

export default plugin

