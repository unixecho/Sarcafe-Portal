# The owner's PC: adb for the kiosk tablet (docs/SARCAFE_KIOSK_REMOTE.md). adb is NOT on the PATH there; it lives in
# C:\Users\Johnathan\android-tools\platform-tools (or set $env:SARCAFE_ADB). Usage, from any folder:
#   powershell -ExecutionPolicy Bypass -File scripts\pc\kiosk-adb.ps1 devices
#   powershell -ExecutionPolicy Bypass -File scripts\pc\kiosk-adb.ps1 pin 01710055
#   powershell -ExecutionPolicy Bypass -File scripts\pc\kiosk-adb.ps1 <any adb arguments>
param([Parameter(ValueFromRemainingArguments = $true)] [string[]] $Args)
$adb = if ($env:SARCAFE_ADB) { $env:SARCAFE_ADB } else { Join-Path $HOME 'android-tools\platform-tools\adb.exe' }
if (-not (Test-Path $adb)) { Write-Error "adb not found at $adb (set `$env:SARCAFE_ADB)"; exit 1 }
if ($Args.Count -ge 2 -and $Args[0] -eq 'pin') {
  if ($Args[1] -notmatch '^\d{6,8}$') { Write-Error 'The PIN must be 6 to 8 digits.'; exit 1 }
  & $adb shell am broadcast -n il.co.sarcafe.kiosk/.KioskConfigReceiver --es pin $Args[1]
  Write-Host 'App 0.3 answers "nothing changed" even when the PIN was saved; app 0.4+ says "PIN set". Test it: 5 taps top-left.'
  exit $LASTEXITCODE
}
& $adb @Args
