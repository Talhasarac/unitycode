---
name: unity-mcp-workflow
description: Operate a live Unity Editor through MCP with resource-first discovery, safe script and scene edits, Unity Test Framework checks, screenshots, and CLI fallbacks.
compatibility: opencode
metadata:
  audience: unity-developers
  workflow: mcp-first
---

# Unity MCP workflow

## Start with evidence

1. Read `mcpforunity://instances`; call `set_active_instance` if routing is ambiguous.
2. Read `mcpforunity://editor/state` and stop mutations until `data.advice.ready_for_tools` is true.
3. Read `mcpforunity://project/info`, `mcpforunity://custom-tools`, the current scene, and relevant object/component resources.
4. Use exact resource URIs returned by resource listing. Resource payloads are nested under `data`.

## Mutate through Unity

- Treat `.unity` scene assets as read-only unless the user's current request explicitly calls for a scene change. Do not create, save, overwrite, rename, move, delete, or persist changes to one by default. Permission to edit prefabs, scripts, UI, or the project generally is not scene-edit permission.
- Without explicit scene-edit permission, verify in Prefab Mode or temporary unsaved staging, restore the prior scene without saving, and disclose any verification limitation that would require a saved scene.
- Use `manage_scene`, `manage_gameobject`, `manage_components`, `manage_asset`, `manage_prefabs`, and `manage_ui` rather than editing serialized YAML.
- Prefer structured resources and tools over `execute_code`. Use arbitrary Editor code only when no dedicated capability can perform the operation, and explain why.
- Use script creation/edit tools and their SHA/stale-file protections for C#.
- Batch independent operations. Use sequential calls for dependent work and `fail_fast=true`.
- Build asset directory trees parent-first after checking which folders already exist.
- Validate live API details with `unity_reflect`; consult Unity docs only after reflection/project evidence when API accuracy matters.

For prefab work, keep temporary roots uniquely named, configure them before saving, verify through prefab and asset tools, delete all staging roots, and do not save unrelated scene state.

## Compile and test

After script changes, poll editor state until compilation/domain reload finishes, then call `read_console` for errors with details. Do not attach a new type until compilation is clean. Run focused tests with `run_tests`, then poll the returned job with `get_test_job`.

Use `bin/unity-cli` only when this project is closed in the Unity Editor. It supports status, version, compile, EditMode/PlayMode tests, and a named static execute method.

## See the result

- Runtime/Game UI or rendering: `manage_camera` screenshot with `include_image=true`.
- Editor layout, gizmos, wireframes: use `capture_source="scene_view"`.
- 3D spatial work: use surround or multiview capture.
- Target 512–768px for inspection; lower sizes are for orientation only.
- After MCP capture, open the returned PNG path with the built-in `read` tool. Some model/provider combinations do not preserve MCP inline image content reliably; the local PNG read is the required visual source of truth.
- Ground the inspection by naming the largest objects, dominant colors, and rough positions. If uncertain, say so and recapture instead of inferring from scene metadata.
- Inspect the pixels, list concrete defects, correct them, and recapture. Cropped, clipped, obscured, intersecting, or badly framed requested content is not a passing visual result.

## Recover

- Busy/reloading: wait and reread editor state.
- Stale script: fetch current SHA and reapply against the new content.
- Wrong instance: list instances and pin one explicitly.
- Silent failure: inspect console and verify scene/object state; do not repeat mutations blindly.
