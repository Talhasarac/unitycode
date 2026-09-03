---
description: Capture and inspect Unity Game or Scene view, then report visual defects
agent: unity
---

Load `unity-mcp-workflow`. Inspect editor state, then capture the most relevant current view with `include_image=true` and `max_resolution=768`. Use Game view for runtime appearance and Scene view for editor geometry; if `$ARGUMENTS` identifies a target, frame that target. Open the saved PNG path with the built-in `read` tool. Ground the inspection by naming the largest objects, dominant colors, and rough positions before reporting specific visible issues in priority order. If the image is unavailable, say so—never infer pixels from hierarchy data. Do not change anything unless explicitly asked.
