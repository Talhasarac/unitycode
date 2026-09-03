---
description: Verify Unity compilation, console, tests, saved state, and visible result
agent: unity
---

Load `unity-mcp-workflow`. Verify the current work without adding unrelated features. Wait for editor readiness, inspect compilation and console errors/warnings, run the smallest relevant EditMode or PlayMode tests and poll to completion, confirm intended non-scene assets are saved, and capture screenshots for visible changes. Never save or otherwise mutate a `.unity` scene during verification unless the user's current request explicitly authorized that scene change. Open every saved screenshot PNG with the built-in `read` tool and perform the object/color/position grounding check before judging it. If verification exposes a defect within the requested scope, fix it and rerun the affected checks. Report exact checks, screenshot paths, results, and remaining uncertainty.
