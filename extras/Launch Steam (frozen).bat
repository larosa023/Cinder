@echo off
rem Launches Steam without letting it self-update.
rem Edit the path below if Steam is installed somewhere else.
set STEAMDIR=C:\Program Files (x86)\Steam

if not exist "%STEAMDIR%\steam.cfg" (
  echo steam.cfg not found in %STEAMDIR% - Steam may try to update!
  pause
)

start "" "%STEAMDIR%\steam.exe" -noverifyfiles -nobootstrapupdate -skipinitialbootstrap -norepairfiles -overridepackageurl
