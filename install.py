"""Where Cinder lives on Windows, and the bits that tie it into Windows.

Cinder installs as a folder (Cinder.exe + _internal) in
%LOCALAPPDATA%\\Programs\\Cinder, so it starts instantly instead of unpacking
itself on every launch. This module handles shortcuts, starting with Windows,
the version marker, and swapping in an update after Cinder exits.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

from cinderlog import log

IS_WIN = sys.platform == "win32"
_NO_WINDOW = 0x08000000
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def install_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    return Path(base) / "Programs" / "Cinder"


def installed_exe() -> Path:
    return install_dir() / "Cinder.exe"


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def is_folder_build() -> bool:
    """True when running from an unpacked folder build (not the single-file exe)."""
    if not is_frozen():
        return False
    exe_dir = Path(sys.executable).resolve().parent
    try:
        return Path(sys._MEIPASS).resolve().parent == exe_dir  # _internal sits next to the exe
    except AttributeError:
        return False


def installed_version() -> str | None:
    try:
        return (install_dir() / "version.txt").read_text(encoding="utf-8").strip() or None
    except OSError:
        return None


def write_version_marker(version: str) -> None:
    try:
        p = Path(sys.executable).resolve().parent / "version.txt"
        if not p.exists() or p.read_text(encoding="utf-8").strip() != version:
            p.write_text(version, encoding="utf-8")
    except OSError:
        pass


# ------------------------------------------------------------------- shortcuts

def _special_folder(name: str) -> Path | None:
    """Desktop / Programs (Start menu) folder for this user."""
    if not IS_WIN:
        return None
    import ctypes
    from ctypes import wintypes
    csidl = {"desktop": 0x10, "programs": 0x02}[name]
    buf = ctypes.create_unicode_buffer(wintypes.MAX_PATH)
    if ctypes.windll.shell32.SHGetFolderPathW(None, csidl, None, 0, buf) == 0:
        return Path(buf.value)
    return None


def create_shortcuts(exe: Path) -> None:
    """Start menu + Desktop shortcuts to the installed Cinder."""
    if not IS_WIN:
        return
    targets = [d / "Cinder.lnk" for d in (_special_folder("programs"), _special_folder("desktop")) if d]
    script = "; ".join(
        f"$s=$w.CreateShortcut('{str(t).replace(chr(39), chr(39) * 2)}'); "
        f"$s.TargetPath='{str(exe).replace(chr(39), chr(39) * 2)}'; "
        f"$s.WorkingDirectory='{str(exe.parent).replace(chr(39), chr(39) * 2)}'; "
        f"$s.IconLocation='{str(exe).replace(chr(39), chr(39) * 2)},0'; "
        f"$s.Description='Cinder'; $s.Save()"
        for t in targets
    )
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
             "-Command", "$w=New-Object -ComObject WScript.Shell; " + script],
            creationflags=_NO_WINDOW, timeout=30, capture_output=True,
        )
        log.info("shortcuts created: %s", ", ".join(str(t) for t in targets))
    except Exception as e:
        log.warning("couldn't create shortcuts: %r", e)


# ------------------------------------------------------------ start with Windows

def startup_enabled() -> bool:
    if not IS_WIN:
        return False
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k:
            winreg.QueryValueEx(k, "Cinder")
            return True
    except OSError:
        return False


def set_startup(enable: bool) -> bool:
    """Start Cinder (in the tray) when you sign in to Windows."""
    if not IS_WIN:
        return False
    import winreg
    exe = Path(sys.executable).resolve() if is_frozen() else None
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
            if enable and exe:
                winreg.SetValueEx(k, "Cinder", 0, winreg.REG_SZ, f'"{exe}" --tray')
            else:
                try:
                    winreg.DeleteValue(k, "Cinder")
                except OSError:
                    pass
        return True
    except OSError as e:
        log.warning("couldn't change startup setting: %r", e)
        return False


# --------------------------------------------------------------- update swap

def schedule_swap(staged: Path, app: Path, pid: int, env: dict) -> None:
    """After process `pid` exits, replace app/{Cinder.exe,_internal} with the staged copy and start it.

    Runs from a hidden cmd script, because a running program can't replace its own files.
    If anything fails, the old copy is put back and started instead.
    """
    q = lambda p: str(p).replace("%", "%%")  # noqa: E731
    script = Path(tempfile.gettempdir()) / f"cinder-update-{pid}.cmd"
    script.write_text("\r\n".join([
        "@echo off",
        "chcp 65001 >nul",
        "setlocal",
        f'set "APP={q(app)}"',
        f'set "NEW={q(staged)}"',
        ":wait",
        f'tasklist /FI "PID eq {pid}" /NH 2>nul | find " {pid} " >nul && (ping -n 2 127.0.0.1 >nul & goto wait)',
        'ping -n 2 127.0.0.1 >nul',
        'if exist "%APP%\\_internal.old" rmdir /s /q "%APP%\\_internal.old"',
        'move "%APP%\\_internal" "%APP%\\_internal.old" >nul || goto fail',
        'move "%NEW%\\_internal" "%APP%\\_internal" >nul || (move "%APP%\\_internal.old" "%APP%\\_internal" >nul & goto fail)',
        'move /y "%APP%\\Cinder.exe" "%APP%\\Cinder.exe.old" >nul',
        'move /y "%NEW%\\Cinder.exe" "%APP%\\Cinder.exe" >nul || (move /y "%APP%\\Cinder.exe.old" "%APP%\\Cinder.exe" >nul)',
        'if exist "%NEW%\\version.txt" move /y "%NEW%\\version.txt" "%APP%\\version.txt" >nul',
        'start "" "%APP%\\Cinder.exe"',
        'ping -n 4 127.0.0.1 >nul',
        'rmdir /s /q "%APP%\\_internal.old" 2>nul',
        'del /f /q "%APP%\\Cinder.exe.old" 2>nul',
        'rmdir /s /q "%NEW%" 2>nul',
        '(goto) 2>nul & del "%~f0"',
        ":fail",
        'start "" "%APP%\\Cinder.exe"',
        '(goto) 2>nul & del "%~f0"',
    ]) + "\r\n", encoding="utf-8")
    subprocess.Popen(["cmd.exe", "/d", "/c", str(script)], creationflags=_NO_WINDOW | 0x00000200,
                     cwd=str(Path(tempfile.gettempdir())), env=env)
    log.info("update swap scheduled: %s -> %s", staged, app)
