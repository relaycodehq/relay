@echo off
rem Runs the headless Relay with the Node.js on PATH (or RELAY_NODE); it needs 22 or newer.
setlocal
if defined RELAY_NODE (set "node=%RELAY_NODE%") else (set "node=node")
where "%node%" >nul 2>nul || if not exist "%node%" (
  echo Relay needs Node.js 22 or newer: https://nodejs.org/en/download 1>&2
  exit /b 1
)
rem (goto) leaves this file first, so relay uninstall can delete it without cmd
rem saying "The batch file cannot be found"; the line was read whole already.
(goto) 2>nul & "%node%" "%~dp0..\lib\relay.cjs" %*
