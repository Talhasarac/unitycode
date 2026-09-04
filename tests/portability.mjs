import assert from "node:assert/strict"
import { chmod, mkdir, mkdtemp, readlink, rm, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const temporary = await mkdtemp(path.join(os.tmpdir(), "unitycode-portability-"))
const project = path.join(temporary, "Project With Spaces")
const mockBin = path.join(temporary, "mock-bin")
const home = path.join(temporary, "home")
const executionPath = `${mockBin}:/usr/bin:/bin`

async function command(name, body) {
  const file = path.join(mockBin, name)
  await writeFile(file, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`)
  await chmod(file, 0o755)
}

function run(script, args = [], options = {}) {
  const result = spawnSync("/bin/bash", [path.join(root, script), ...args], {
    cwd: options.cwd ?? temporary,
    env: { ...process.env, HOME: home, PATH: executionPath, ...options.env },
    encoding: "utf8",
  })
  assert.equal(result.status, 0, `${script} failed:\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}

try {
  await mkdir(path.join(project, "Assets"), { recursive: true })
  await mkdir(path.join(project, "Packages"), { recursive: true })
  await mkdir(path.join(project, "ProjectSettings"), { recursive: true })
  await mkdir(mockBin, { recursive: true })
  await mkdir(home, { recursive: true })
  await writeFile(path.join(project, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.1f1\n")

  await command("uname", "printf 'Linux\\n'")
  await command(
    "ps",
    `printf '%s\\n' '/opt/Unity/Hub/Editor/6000.0.1f1/Editor/Unity -projectpath "${project}"'`,
  )
  await command("opencode", "printf '%s\\n' \"$*\"")

  const cli = run("bin/unity-cli", [project, "status"])
  assert.match(cli, new RegExp(`unity_executable=${home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/Unity/Hub/Editor/6000\\.0\\.1f1/Editor/Unity`))
  assert.match(cli, /editor_open=yes/)

  const outside = path.join(temporary, "outside")
  await mkdir(outside)
  const launch = run("bin/UnityCode", [], { cwd: outside, env: { UNITY_MCP_URL: "http://127.0.0.1:8080/mcp" } })
  assert.match(launch, /--agent unity/)
  assert.match(launch, /Project With Spaces/)

  const installBin = path.join(temporary, "install-bin")
  const installDirectory = path.join(temporary, "installed", "unitycode")
  await command(
    "git",
    `target=\"\${!#}\"\nmkdir -p \"$target/.git\" \"$target/bin\"\nprintf '#!/usr/bin/env bash\\nexit 0\\n' > \"$target/bin/UnityCode\"\nchmod 755 \"$target/bin/UnityCode\"`,
  )
  await command("npm", "exit 0")
  await command("curl", "exit 0")

  const install = run("install.sh", [], {
    env: {
      PATH: `${installBin}:${executionPath}`,
      UNITYCODE_INSTALL_DIRECTORY: installDirectory,
      UNITYCODE_BIN_DIRECTORY: installBin,
      UNITYCODE_REPOSITORY_URL: "https://example.invalid/unitycode.git",
    },
  })
  assert.match(install, /Ready: type unitycode in this terminal\./)
  assert.equal(await readlink(path.join(installBin, "unitycode")), path.join(installDirectory, "bin", "UnityCode"))

  console.log("portability: ok")
} finally {
  await rm(temporary, { recursive: true, force: true })
}
