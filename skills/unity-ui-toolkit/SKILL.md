---
name: unity-ui-toolkit
description: Design, implement, debug, and visually verify Unity UI Toolkit runtime or Editor interfaces using UXML, USS, C#, responsive layouts, interaction states, and accessibility checks.
compatibility: opencode
metadata:
  audience: unity-ui-engineers
  workflow: screenshot-loop
---

# Unity UI Toolkit

## Discover first

Confirm whether the target is runtime UI or an EditorWindow/inspector. Read project info and search for existing `.uxml`, `.uss`, `PanelSettings`, themes, fonts, custom controls, and naming conventions. Inspect existing visual trees through `manage_ui` before adding a new root.

## Build in layers

- UXML owns hierarchy and semantic grouping.
- USS owns layout, spacing, typography, color, state selectors, and transitions.
- C# owns data, event callbacks, navigation, and state changes.
- Use class names for reusable presentation and `name` only for stable queried elements.
- Cache `Q<T>()` results. Register callbacks once and unregister symmetrically. Avoid querying or allocating every frame.

Use Flexbox and explicit sizing constraints. Design for long/localized text, compact windows, ultrawide windows, safe areas, and DPI scaling. Make overflow and scroll behavior intentional. Avoid absolute positioning except true overlays.

## States to exercise

Test relevant combinations: default, hover, active, focus, keyboard focus, disabled, selected, empty, loading, error, populated, long text, and rapid repeated interaction. Confirm picking mode and z-order do not block controls.

## Visual loop

Enter the correct Editor or Play Mode state. Capture an inline screenshot at a useful resolution, then open the saved PNG path with OpenCode's built-in `read` tool. First name the largest regions, dominant colors, and rough positions to ground the image. Inspect hierarchy, alignment, rhythm, clipping, text wrapping, contrast, focus indication, hit targets, and accidental scrollbars. Fix and recapture at least once after a material UI change. Test a compact and wide viewport when the tools allow it.

## Debugging order

1. Confirm UIDocument, PanelSettings, source asset, sort order, and active state.
2. Inspect the live visual tree and resolved styles.
3. Check console errors and missing asset references.
4. Check picking, display/visibility, opacity, overflow, flex growth/shrink, and absolute positioning.
5. Confirm callbacks are registered after the visual tree exists and on the correct element.
