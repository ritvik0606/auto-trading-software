@echo off
setlocal

set "ROOT=%~dp0"

echo Stopping Auto Trading Software local Node processes...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = [System.IO.Path]::GetFullPath('%ROOT%').TrimEnd('\');" ^
  "$escapedRoot = [Regex]::Escape($root);" ^
  "$targets = Get-CimInstance Win32_Process | Where-Object { " ^
  "  $_.CommandLine -and " ^
  "  ($_.Name -in @('node.exe','npm.exe','npx.exe','cmd.exe')) -and " ^
  "  ($_.CommandLine -match $escapedRoot) -and " ^
  "  ($_.CommandLine -match 'npm run dev|nodemon|vite|src/server\.js|backend|frontend') " ^
  "};" ^
  "if (-not $targets) { Write-Host 'No matching local app processes were found.'; exit 0 }" ^
  "$targets | Sort-Object ProcessId | ForEach-Object { Write-Host ('Stopping PID {0}: {1}' -f $_.ProcessId, $_.CommandLine); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

echo.
echo Done.

endlocal
