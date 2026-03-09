# Native Cursor for Obsidian

A minimal Obsidian plugin that gives the editor cursor a more distinctive, native feel; wider, colored, and with controllable blinking. No movement animations, no blur, no fuss.

Inspired by [iA Writer](https://ia.net/writer) by Information Architects and [Animated Cursor](https://github.com/kotaindah55/animated-cursor) by Kotaindah55.

## Features

- **Adjustable cursor width**: make the cursor as thin or chunky as you like (1–6px).
- **Separate colors for dark and light mode**: set an accent color that looks right in both themes.
- **Blink toggle**: keep the standard blink, or turn it off entirely for a static cursor.
- **Reset to defaults**: one button to rule them all and restore all settings to their original values.
- **No movement animation**: the cursor snaps instantly to its new position, just like a native app.

## Installation

### Community plugins (recommended)

1. Open **Settings → Community plugins**.
2. Search for **Native Cursor**.
3. Click **Install**, then **Enable**.

### Manual

1. Download `main.js`, `styles.css`, and `manifest.json` from the [latest release](../../releases/latest).
2. Create a folder at `<your vault>/.obsidian/plugins/native-cursor/`.
3. Copy the three files into that folder.
4. Reload Obsidian, then go to **Settings → Community plugins** and enable **Native Cursor**.

## Settings

| Setting | Description | Default |
|---|---|---|
| Cursor width | Width of the cursor in pixels | 3px |
| Dark mode cursor color | Cursor color when Obsidian is in dark mode | `#4A8FF7` |
| Light mode cursor color | Cursor color when Obsidian is in light mode | `#1A6FE8` |
| Cursor blink | Enable or disable cursor blinking when idle | On |
| Reset to defaults | Restore all settings to their original values | — |

## Notes

- The styled cursor applies to the **main editor** (source and live preview modes). Native browser inputs such as the note title, frontmatter fields, and search are not affected — browsers do not expose cursor width styling for those elements.
- This plugin works by patching CodeMirror's internal cursor layer, following the same minimal approach used by animated-cursor. It intentionally avoids registering new CodeMirror extensions to reduce the risk of conflicts with other plugins or Obsidian updates.
- The Lazy Plugin Loader has a tendency to disable the plugin when quitting and reopening Obsidian.

## Compatibility

- Requires Obsidian **1.4.0** or later
- Desktop and mobile supported

## License

MIT