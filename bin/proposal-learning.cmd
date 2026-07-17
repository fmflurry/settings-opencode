@echo off
setlocal
set "ROOT=%~dp0.."
set "STATE_CLI=%ROOT%\plugins\learning\state-cli.ts"
if not exist "%STATE_CLI%" set "STATE_CLI=%ROOT%\hooks\learning\state-cli.ts"
node --experimental-strip-types "%STATE_CLI%" %*
