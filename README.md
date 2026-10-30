# Cinder

A fast, clean, themeable front end for your Steam library on Windows.

Cinder reads the library Steam already keeps on your PC and launches games through your installed Steam client, which runs quietly in the background. It never asks for your password and never talks to Valve's servers itself, so your account, DRM, cloud saves and any tools that patch Steam (like Steamidra) keep working exactly as before.

It also **keeps Steam on the build you have now** by managing `steam.cfg` and launching Steam with update-blocking flags.

## Features

**Tabs, like Steam, on your theme**

- **Library**: cover grid of installed games across every Steam library folder, a "Jump back in" row, instant search (`/`, `Enter` launches the top result), filters and sorting. With an API key it also shows owned games you haven't installed, with an Install button.
- **Library layouts** (switcher next to Lists, with a size slider): **Covers**, **Banners**, **Tiles** (wide art with the name on it), **List** (sortable columns for play time, last played, achievements and size) and **Shelves** (Favorites, Updates ready, Continue playing, Installed, Haven't played yet, Most played, Not installed). New layouts are one entry in `LAYOUTS` in `ui/js/library.js`
- **Store**: featured deals, top sellers, new releases and coming soon, store search, and full game pages with screenshots, details, tags and price. **Buy in Steam** opens the checkout in your real Steam client.
- **Wishlist**: your wishlist with live prices and discounts, total value, sorting and an "On sale" filter.
- **Friends**: your friends list. With an API key you also see who's online and what they're playing. **Message** opens Steam chat.
- **Profile**: your profile or a friend's, with avatar, status, about, play stats, recently played and most played.

**While you play**

- A "Now playing" pill in the top bar with a session timer (click it for the game page)
- Cinder minimizes or hides to the tray when a game starts and comes back when it closes (Settings → General)
- **Downloads tab**: what's downloading now (big progress bar, speed graph in MB/s, Mbps or both, peak speed, time left and when it'll finish), the queue (**Start now** moves a game to the front, pause, resume, remove), updates waiting (**Update all**) and what finished. When connected to Steam the numbers are live from Steam itself; otherwise they're read from Steam's files
- **Update games without launching them**: an Update button on the cover badge, the game page, the right-click menu and the Downloads panel (with **Update all**). Downloads can be paused, resumed and reordered from the Downloads tab. No Steam window opens: Cinder asks Steam's own interface to do it (Settings → Steam → Update games from Cinder). The first time, Steam restarts once in the background to switch on its local debugging connection (only reachable from your PC)

**Achievements, lists and your profile**

- Achievements tab: everything you've unlocked across your games, recent and rarest unlocks, games closest to 100%, and per-game progress (gathered in the background and cached)
- Achievement progress on covers: a trophy badge and progress bar (gold at 100%) on each game while you're viewing a list, or always (Settings → Appearance → Game cards)
- Game lists: your Steam collections appear automatically (read from Steam's files), plus Cinder lists you make. Pick a list from **Lists** in the library; right-click a game to add it to a list
- Customize your Cinder profile: background from any game's art, a showcase of up to 4 games, which sections show, banner size. **Edit on Steam** jumps to each part of Steam's own profile editor

**Couch mode**

- A full-screen view made for a controller: your games as retro game cases on shelves (Continue playing, Favorites, Playing, All installed, Backlog, Top rated, your lists), with the focused game's art behind
- Open it from the controller button in the top bar, F11, or your controller's Start button. D-pad or stick moves (hold to scroll faster), A opens, Y plays, X favorites, LB/RB jump, B or Esc leaves. Mouse and keyboard work too
- Controller input is ignored whenever a game (or anything else) has focus

**Your games, your notes**

- Rate games 1–5 stars, set a status (Playing, Backlog, Beaten, 100%, Dropped) and keep notes, on each game page; filter by status, sort by rating, and see it in List view and Shelves
- Launch options per game: saved straight into Steam when connected, into Steam's settings file when Steam is closed, or the next time it closes

**Stats and storage**

- Stats tab: this week, last 30 days, Steam's last two weeks and all-time totals, a 30-day chart, streaks, most played lately and ever, by weekday and time of day, recent sessions (Cinder records sessions from 0.17 on)
- Storage tab: each drive's games, other files and free space; biggest, not played in 6 months and never played; move a game to another drive (Steam's own move, when connected) or uninstall

**Steam Workshop**

- Workshop tab: every game you have workshop items for, with item counts, size on disk and updates waiting (read from Steam's own files)
- Each game's workshop: **Your items** (subscribed mods, plus items the game installed itself) and **Browse** (Trending, Most popular, Top rated, Newest, Recently updated, or search with Enter)
- Item pages with preview, subscribers, favorites, size, tags and description. **Subscribe in Steam** opens the item in Steam to subscribe or unsubscribe, the same way buying works. **Open folder** goes to its files. **Update now** asks Steam for the newest version when you're connected
- Games with a Steam Workshop get a **Workshop** button and tab on their game page (with your item count and pending updates), and store pages get a Workshop button. Detected from your files or the game's store page, and remembered

**Game pages**

- Tabs for Achievements (unlock dates and how rare each one is), News and patch notes, and DLC (with what you have installed)
- Steam reviews: the score ("Very Positive · 91% of 45,123") on game and store pages, and a Reviews tab with most helpful, recent, positive and negative reviews
- Non-Steam games you've added to Steam show up too, with any custom art you've set, and launch through Steam
- Wishlist sale alerts: a Windows notification when something on your wishlist goes on sale (Settings → Account)

**Organize**

- Favorites stay pinned to the top; hide games you never play (right-click any game, or use its page)
- "Pick for me" opens a random installed game, nudging toward ones you haven't played

**Status and quiet launching**

- Click your name in the top bar to set your Steam status: Online, Away, Invisible or Offline. After each change Cinder checks what friends actually see (your public profile, or the Web API with a key) and warns you if Steam hasn't applied it
- When you launch a game, if Steam pops its library window up, Cinder sends it straight back to the tray (Settings → Steam; Steam's small prompts like launch options or cloud saves still show)

**Make it yours**

- 5 built-in themes plus drop-in CSS themes
- **Quick style**, layered on any theme: accent color, top bar or sidebar navigation, tall or wide covers, corners, density, font, background (solid, glow, or blurred art from your last played game), shadows, blur, animations, cover size
- **Game cards**: choose what shows under each cover (play time, last played, both, achievements, size or nothing), how play time reads (733 hrs, 733h 20m, 30d 13h, 733.3 h), how dates read (2 days ago, Oct 26, 2026, numeric, 2026-10-26), names on one or two lines, and hiding ™/®/© in names
- **Save as theme** turns your current look into a theme file

**Window**

- Borderless window with its own title bar
- Drag to the top of the screen to maximize; drag to the left or right edge to snap to half the screen
- Drag a maximized window to restore it; double-click the title bar to maximize or restore
- Resize from any edge or corner

**Steam and updates**

- Launches games through your installed Steam; never asks for your password
- **Only run Steam when needed** (Settings → Steam, off by default): Steam stays closed while you browse in Cinder, starts in the background for Play, Update, status changes or Steam windows, and closes after a few idle minutes (no game running, nothing downloading, no Steam window open). While it's closed, friends see you offline
- **Steam update freeze**: keeps the client on its current build; update it on demand from Settings
- **Built-in Cinder updater**: new versions install from GitHub releases, so you don't re-download the exe

The ✦ button in the top bar opens **What's new**: every Cinder update, newest first, with a dot when there's something you haven't seen.

Shortcuts: `Ctrl+B` collapses the sidebar to icons, `Ctrl+1`–`9` switch tabs, `F11` couch mode, `Alt+←` / mouse back button goes back, `F5` refreshes, `Ctrl+,` opens Settings.

## Optional: Steam Web API key

Everything works without one. Adding a key (Settings → **Account**) unlocks live friend status, your Steam level and owned-but-not-installed games. Get one free at https://steamcommunity.com/dev/apikey; any domain name works, e.g. `localhost`. The key is saved only in `%APPDATA%\Cinder\config.json` and is never shown back in the app.

For the Wishlist and Profile tabs, Steam needs your profile and game details set to **Public** (Steam → Profile → Edit Profile → Privacy Settings).

## Install

Download **Cinder.exe** from the [latest release](https://github.com/larosa023/Cinder/releases/latest) and run it once. It offers to install the faster version: Cinder then lives in `%LOCALAPPDATA%\Programs\Cinder`, opens instantly from its Start menu and Desktop shortcuts, and keeps itself up to date. You can delete the downloaded `Cinder.exe` afterwards (Cinder offers to).

Needs Windows 10/11 and Steam installed and signed in once.

Cinder lives in the tray: closing the window keeps it running (Settings → General), and it can start with Windows.

### Run from source

```bat
git clone https://github.com/larosa023/Cinder
cd Cinder
run.bat
```

`build.bat` builds both versions locally (`dist\Cinder\` and `dist\Cinder.exe`).

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

**Publishing a new version** (for the repo owner): add an entry at the top of `ui/changelog.json` (it feeds the What's new panel), bump `VERSION` in `version.py` (e.g. `0.3.1`) and push to `main`. The **Release** GitHub Action builds `Cinder.exe` on Windows and publishes release `v0.3.1`, usually within a few minutes. Every copy of Cinder will then offer the update. Publishing a release by hand on GitHub still works too.

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

(Settings → **Open my themes folder**.) Quick style (Settings → Appearance) works on top of any theme. **Save as theme** writes your current look into this folder. By hand, a theme sets color variables and can override any other style:

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
| `storeapi.py` | Store, wishlist, friends and profile data from Steam's public endpoints, with caching |
| `winsnap.py` | Moving, snapping and resizing for the borderless window |
| `steamart.py` | Finds every game's art: Steam's local cache and asset index (`assetcache.vdf`), Steam's image servers, then the store API |
| `steambridge.py` | Asks the running Steam client to update games and pause/resume downloads (Steam's local debugging connection) |
| `steamidle.py` | "Only run Steam when needed": closes Steam once nothing needs it |
| `steamquiet.py` | Keeps Steam's main window in the tray while Cinder launches games or changes your status |
| `server.py` | Local-only HTTP server (127.0.0.1) that serves the UI and a small JSON API, guarded by a per-session token |
| `updater.py` | Cinder self-updater (GitHub releases) |
| `version.py` | Current version and the repo updates come from |
| `install.py` | Install location, shortcuts, start with Windows, swapping in updates after exit |
| `tray.py` | Tray icon, its menu, and Windows notifications |
| `playing.py` | Notices when a game starts and stops (Steam's RunningAppID) |
| `workshop.py` | Your workshop items (from Steam's files), item details and workshop browsing |
| `gamedata.py` | Your ratings, status and notes; play sessions and stats; launch options |
| `achievements.py` | Gathers your achievements across games in the background for the Achievements tab |
| `sales.py` | Checks your wishlist every few hours for new sales |
| `main.py` | Starts everything and opens the window |
| `.github/workflows/release.yml` | Builds and publishes `Cinder.exe` when a `v*` tag is pushed |
| `ui/` | The interface (plain HTML/CSS/JS, no frameworks), one script per tab in `ui/js/` |
| `themes/` | Built-in themes |

Games launch through `steam://rungameid/<appid>`. If Steam isn't running, Cinder starts it with the freeze flags and `-applaunch`.

---

Cinder is an independent project and isn't affiliated with or endorsed by Valve. Steam is a trademark of Valve Corporation.
