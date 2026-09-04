# Live test report

Tested on 2026-09-04 against:

- OpenCode 1.18.4 initially; OpenCode auto-updated to 1.18.27 during final TUI verification
- Unity 6000.3.12f1
- Project `/path/to/UnityProject`
- MCP for Unity package from `com.coplaydev.unity-mcp`
- MCP Streamable HTTP endpoint `http://127.0.0.1:8080/mcp`

## Passed

- Harness shell syntax and required-file validation
- Unity project/version/executable discovery
- Detection of an already-open Unity project
- Refusal to start a second batch-mode Editor on that open project
- MCP JSON-RPC initialize handshake
- OpenCode MCP discovery and connection
- OpenCode discovery of both harness skills and the Unity primary agent
- DeepInfra authentication through an environment variable (not persisted in the harness)
- MCP resource calls for instances, editor state, project info, current scene, and console
- Unity Scene view screenshot capture to `Assets/Screenshots/screenshot-20260904-012915.png`
- Local PNG ingestion through OpenCode's built-in image reader
- Combined default-model MCP plus visual grounding smoke test
- Installed `UnityCode` command resolved through the user's PATH
- Automatic detection of the currently open `GI_TEST` project
- Terminal title changed to `UnityCode — GI_TEST`
- TUI `home_logo` slot visibly replaced with the UnityCode logo
- Default-agent specialist tool hiding verified against the actual outgoing API request
- `unity-full` agent added to preserve the complete Unity MCP and subagent tool surface
- `dumpmode` agent verified with a minimal search/C#-editing tool set, no MCP tools, and 1,560 input tokens for a live local-Qwen `hello` request
- Server coordinator plugin loaded successfully through the real OpenCode 1.18.27 startup path
- Live one-shot UnityCode launch registered and heartbeated its session under the selected project's `Library/UnityCode/Coordination`; the interrupted process became stale and was removed as designed
- Atomic `.cs`/`.prefab` claims, exact-path conflicts, compiler/editor lane conflicts, hash-change detection, message delivery, rollback, lease expiry, and fenced stale takeover passed automated tests
- Concurrent renew/release/takeover scenarios passed 50 repeated stress runs without an old session affecting the replacement lease
- Simulated Linux validation passed for Unity Hub executable discovery, running-project detection, quoted project paths containing spaces, and launcher handoff
- Isolated installer validation passed with mocked network commands, a writable active PATH directory, dependency installation, and the final `unitycode` symlink

The captured default request contains 47 tools and approximately 18,120 tokens of tool schemas. All 14 requested specialist/subagent tools are absent, while web access, `unity_docs`, and `unity_reflect` remain present. The captured `unity-full` request restores all 61 tools and approximately 28,894 tokens of tool schemas.

## Muse Spark 1.3 evaluation

`opencode/muse-spark-1.3-contributor-free` created and verified three prefabs in the live test project, assigned existing materials, performed screenshot grounding, recovered from an initial poor staging arrangement, and removed its temporary GameObjects. It exposed three instruction weaknesses: attempting a nested folder before its parent, using `execute_code` for checks covered by structured tools, and accepting a screenshot with a severely clipped pillar as a pass. The operating prompt and Unity workflow skill were tightened to address those observed behaviors.

The three resulting assets are:

- `Assets/UnityCodeMuseTest/Prefabs/UC_Crate.prefab` — red cube, scale `1.2, 1.2, 1.2`
- `Assets/UnityCodeMuseTest/Prefabs/UC_Pillar.prefab` — blue cylinder, scale `0.7, 2, 0.7`
- `Assets/UnityCodeMuseTest/Prefabs/UC_Target.prefab` — red sphere, scale `1, 1, 1`

A second Muse run received only a plain verification request, so the revised first prompt had to supply the workflow discipline. It used the structured prefab, asset, material, scene, screenshot, console, and test tools without `execute_code`; restored `OutdoorsScene`; removed `Assets/UnityCodeMuseTest/UC_Verify_Temp.unity`; left no staging references; reported zero console errors; and passed the `GI_TEST` EditMode test. Its final Game-view screenshot showed all three prefabs fully visible, separated, correctly colored, and accurately described.

An exact outgoing-request capture measured the lean agent before and after the prompt rewrite. The system text fell from 12,961 to 11,754 characters—roughly 3,240 to 2,938 tokens—while the 47-tool surface remained unchanged at roughly 18,120 schema tokens. This saves about 302 prompt tokens per request and produced better behavior in the observed retry.

## Model finding

`moonshotai/Kimi-K2.7-Code` successfully used Unity MCP tools but twice gave incorrect visual grounding for the saved PNG. `Qwen/Qwen3.5-397B-A17B` correctly identified the foreground red cube, rear-left blue cube, and white platform, while also using Unity MCP resources. Qwen remains the preferred DeepInfra option. The harness no longer pins Muse—or any other model—so removal of a provider model cannot prevent startup; OpenCode selects its available default unless the user supplies an explicit override.

## Deliberately not tested

- Destructive scene/asset edits
- C# compilation changes
- PlayMode test execution
- UI Toolkit asset creation in the test project

The safe CLI guard correctly prevented a second Editor, while EditMode testing was performed through the running Editor's MCP connection. The remaining workflows are encoded in the agent, skills, commands, and safe CLI helper, but should be exercised on a disposable or version-controlled Unity project before trusting broad autonomous edits.

## Default scene safety

The default and full agents now treat `.unity` scene assets as read-only unless the user's current request explicitly asks for a scene change. Prefab, script, UI-asset, and general project requests do not implicitly authorize creating, saving, overwriting, renaming, moving, deleting, or persisting hierarchy changes to a scene. Read-only inspection, Prefab Mode, and temporary unsaved staging remain available.

## Simple Mode payload

The `simplemode` agent uses a deny-all permission followed by a small explicit allowlist. A captured OpenCode 1.18.27 `hello` request contained 15 tools, 16,670 characters of tool schemas, and 34,758 bytes total. That is approximately 8.7k tokens using a four-characters-per-token estimate; the exact result depends on the selected model tokenizer and user-level global instructions. The resolved-agent regression test confirms that file read/search/edit and coordination remain enabled while shell, web, skills, subagents, and todo tools remain hidden.

## Dump Mode payload

The `dumpmode` agent is intended for quick questions and small C# changes. Its outgoing request contains search, edit/write, and coordination tools but no Unity or generic MCP tools. The coordinator replaces the normal project instructions with a compact, single system message and blocks this mode from mutating non-`.cs` paths. A live `hello` request against `qwen3.6-hauhaucs-aggressive` used 1,560 input tokens and 35 output tokens. An isolated request-capture regression test enforces the tool surface and a conservative 6,000-character input ceiling.

The same capture test verifies that both `dumpmode` and `simplemode` send exactly one first-turn model request. Their session titles are assigned locally from the first 10 normalized user-input characters, preventing OpenCode's hidden title agent from making a second request.

## Multi-agent coordination

The server plugin now registers active sessions, injects a fresh project-local coordination snapshot into each model call, supports direct or broadcast messages, and enforces heartbeat-backed leases before protected OpenCode or Unity MCP mutations. `.cs` claims include the exact asset, C# compiler lane, and Unity Editor write lane; `.prefab` claims include the exact asset and editor lane. A SHA-256 baseline blocks mutation when an owned asset changed externally after the claim.

The edge-case test covers simultaneous claims, partial-claim rollback, crashed-owner expiry, stale takeover, renewal racing takeover, old-owner release racing renewal, and lease-ID fencing. Coordination is deliberately documented as local cooperative protection rather than a cross-machine distributed lock or security boundary.
