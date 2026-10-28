# Cinder

A fast, clean, themeable front end for your Steam library on Windows.

Cinder reads the library Steam already keeps on your PC and launches games through your installed Steam client, which runs quietly in the background. It never asks for your password and never talks to Valve's servers itself, so your account, DRM, cloud saves and any tools that patch Steam (like Steamidra) keep working exactly as before.

It also **keeps Steam on the build you have now** by managing `steam.cfg` and launching Steam with update-blocking flags.

## Features

- Cover-art grid of every installed game across all your Steam library folders
- "Jump back in" row for recently played games
- Instant search (`/` or `Ctrl+F`, `Enter` launches the top result)
- Filters (played / unplayed / needs update) and sorting (recent, name, play time, size, last updated)
- Game page with hero art, logo, play time, last played, size and install path
- Play, open folder, Steam properties, store page and uninstall
- Shows your Steam name and avatar, plus a live Steam status dot
- **Steam update freeze**: one toggle writes or removes `steam.cfg`
- Starts Steam silently with the freeze flags when Cinder opens (optional)
- 5 built-in themes, plus drop-in custom CSS themes
- **Built-in updates for Cinder**: checks GitHub releases and installs new versions in place, so you never re-download the exe
- **On-demand Steam updates**: shows your locked Steam build vs. the newest one, and updates Steam with one click, then re-blocks it
- Borderless window with its own title bar
- Tiny: Python standard library plus `pywebview` (uses the Edge WebView2 built into Windows 10/11)

## Run it

Needs Windows 10/11, Steam installed and signed in once, and Python 3.10+ from python.org.

```bat
git clone https://github.com/larosa023/Cinder
cd Cinder
run.bat
```

The first run creates a `.venv` and installs `pywebview`. After that, `run.bat` just opens Cinder.

### Build a single .exe

```bat
build.bat
```

The result is `dist\Cinder.exe`. Pin that to your taskbar and use it instead of Steam's shortcut.

### Other options

```
python main.py --browser     open the UI in your web browser instead of a window
python main.py --no-steam    don't start Steam automatically
python main.py --port 8765   use a fixed local port
```

## Steam update freeze

With **Block Steam client updates** on (the default), Cinder keeps this in your Steam folder:

```
BootStrapperInhibitAll=enable
BootStrapperForceSelfUpdate=disable
```

Whenever Cinder starts Steam, it also passes `-noverifyfiles -nobootstrapupdate -skipinitialbootstrap -norepairfiles -overridepackageurl`.

Steam usually lives in `C:\Program Files (x86)`, which can need admin rights to write. If the toggle reports a permission error, run Cinder as administrator once, or copy `extras\steam.cfg` into your Steam folder by hand. `extras\Launch Steam (frozen).bat` starts Steam with the freeze flags without Cinder.

This only stops the **Steam client** from updating. Individual games still update through Steam as normal.

## Updates

Settings → **Updates** has both updaters. With "Check for updates when Cinder opens" on, Cinder only *checks*. Nothing installs until you click.

### Cinder

Cinder checks this repo's latest GitHub release. When a newer version is out, a banner appears; click **Update**, then **Restart**.

| How you run Cinder | What Update does |
| --- | --- |
| `Cinder.exe` | Downloads the new `Cinder.exe` from the release, verifies its SHA-256, swaps it in, keeps the old one until the next launch |
| `run.bat` from a `git clone` | `git pull --ff-only`, then refreshes dependencies |
| `run.bat` from a downloaded zip | Unpacks the release's source over the folder (your `.venv` is left alone) |

**Publishing a new version** (for the repo owner):

1. Bump `VERSION` in `version.py`, e.g. `0.2.1`.
2. Commit and push.
3. On GitHub, go to **Releases → Draft a new release**, type the tag `v0.2.1` (choose "create new tag on publish"), and click **Publish release**. Pushing a `v0.2.1` tag from git works too.

The **Release** GitHub Action builds `Cinder.exe` on Windows and attaches it to the release, usually within a few minutes. Every copy of Cinder will then offer the update.

### Steam

Steam stays blocked by default. When you choose to update it (Settings → **Update Steam now**), Cinder:

1. Closes Steam.
2. Removes the update block.
3. Opens Steam normally so it downloads and installs its update.
4. Re-blocks updates once the new build is in place, or after a few minutes if there was nothing to download.

The Steam row shows your installed build (the number in *About Steam*) and, when Valve's update server is reachable, the newest build. A new Steam build can break Steamidra until you re-apply it, so update Steam only when you're ready to.

If Cinder is closed mid-update, it re-blocks Steam updates the next time it opens.

## Themes

Themes are plain CSS files. The built-in ones are in `themes/`. Your own go in:

```
%APPDATA%\Cinder\themes\
```

(Settings → **Open my themes folder**.) A theme sets color variables and can override any other style:

```css
/*
  @name   My Theme
  @author you
  @swatch #101010 #202020 #ff3d7f
*/
:root {
  --bg: #101010;
  --bg-elev: #161616;
  --surface: #202020;
  --surface-hover: #2a2a2a;
  --border: #2c2c2c;
  --text: #f0f0f0;
  --text-dim: #8f8f8f;
  --accent: #ff3d7f;
  --accent-text: #ffffff;
  --shadow: rgba(0,0,0,.5);
}

/* optional extra styling */
.art { border-radius: 4px; }
```

The `@swatch` colors are what the theme picker shows. A user theme with the same file name as a built-in one replaces it.

## Settings file

`%APPDATA%\Cinder\config.json` holds your theme, sort order, cover size and toggles. Set `"steam_path"` if Steam is installed somewhere unusual and Cinder can't find it.

## How it works

| File | What it does |
| --- | --- |
| `steamlib.py` | Finds Steam, parses `libraryfolders.vdf`, `appmanifest_*.acf`, `loginusers.vdf` and `localconfig.vdf`, finds cached artwork, starts Steam, handles the freeze and the on-demand Steam updater |
| `server.py` | Local-only HTTP server (127.0.0.1) that serves the UI and a small JSON API, guarded by a per-session token |
| `updater.py` | Cinder self-updater (GitHub releases) |
| `version.py` | Current version and the repo updates come from |
| `main.py` | Starts everything and opens the window |
| `.github/workflows/release.yml` | Builds and publishes `Cinder.exe` when a `v*` tag is pushed |
| `ui/` | The interface (plain HTML/CSS/JS, no frameworks) |
| `themes/` | Built-in themes |

Games launch through `steam://rungameid/<appid>`. If Steam isn't running, Cinder starts it with the freeze flags and `-applaunch`.

---

Cinder is an independent project and isn't affiliated with or endorsed by Valve. Steam is a trademark of Valve Corporation.
