# Vertrice Crush palettes

`vertrice-day` uses neutral paper surfaces and muted blue, green and plum accents.
`vertrice-night` uses slate surfaces with the same accent families. Both define
all supported Crush palette tokens, including code/diff panels, buttons and ANSI
output colors; neither depends on inherited dark surfaces for its light mode.

In Crush, open Ctrl+P, choose **Themes**, then preview and select either palette.
Escape cancels the preview. Files must be installed under the normal Crush config
directory's `themes/` directory. No account or provider changes are needed.

These are application palettes, not terminal palettes. The patched Crush runtime
supports `options.tui.active_theme: "terminal"`: it queries terminal colors,
selects the matching palette and reloads changed palette files within about two
seconds. The Themes picker also offers `terminal` to return from a fixed theme
to automatic following. Fixed selections remain fixed. This requires the patched
binary; installing palette files alone does not add these capabilities. Existing
processes must restart once to adopt a new binary, after which palette edits can
reload without restarting. Xterm must advertise its real color capability through
`XTerm*termName: xterm-direct`; otherwise pale colors can collapse into customized
dark ANSI slots. Transparency is not a substitute for consistent panel colors.

The standalone developer test `crush-theme-assets.py` checks full token coverage,
ordinary text at 4.5:1 contrast on all three main surfaces, ANSI output, buttons
and diffs.
Crush reuses `primary` behind both base text and inverse text, as well as for
foreground accents. Those conflicting uses cannot all meet 4.5:1 with this token
API; the palettes use a middle-value primary and require 3:1 for those specific
pairs. This is a documented runtime styling limitation, not an accessibility
claim. The application needs separate foreground/selection tokens to remove it.

Contrast checks do not establish visual acceptance. Check the actual terminal
with ordinary text, tool output, Markdown headings and code, inserted/deleted
lines, permission dialogs, selected lists, buttons and disabled controls. Repeat
in day and night, and after a desktop transition. These files do not implement
automatic live day/night switching or change the system terminal palette.
