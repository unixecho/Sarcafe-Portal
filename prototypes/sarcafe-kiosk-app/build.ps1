# Builds the Sarcafe kiosk APK with the Android SDK command-line tools only (no Gradle, no downloads).
# Output goes outside the repo. Run from anywhere:  powershell -File build.ps1
# Windows PowerShell 5.1 turns any stderr line (javac notes) into an error under 'Stop', so each native
# call is checked by exit code instead.
# -VersionCode must go up with every APK (Android refuses an update with a lower or equal code); 2 is the first
# APK that can update itself over the air.  powershell -File build.ps1 -VersionCode 3 -VersionName 0.3
param([int]$VersionCode = 2, [string]$VersionName = '0.2')
$ErrorActionPreference = 'Continue'
function Run {
    $a = @(); foreach ($x in $args) { $a += $x }   # flattens array arguments such as the source list
    $exe = $a[0]; $rest = $a[1..($a.Count - 1)]
    & $exe @rest
    if ($LASTEXITCODE -ne 0) { throw "failed: $exe (exit $LASTEXITCODE)" }
}

$root   = $PSScriptRoot
$sdk    = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$bt     = Join-Path $sdk 'build-tools\36.1.0'
$aj     = Join-Path $sdk 'platforms\android-36\android.jar'
$jdk    = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.7.6-hotspot'
$out    = 'C:\Users\Johnathan\android-tools\kiosk-build'

# The signing settings come from the environment, never from this file. When they are not set, the owner's env file
# (outside the repo, next to the keys) is read: SARCAFE_KIOSK_KEYSTORE, SARCAFE_KIOSK_KS_ALIAS, SARCAFE_KIOSK_KS_PASS.
# Nothing in it is printed. The first keystore (sarcafe-kiosk.keystore, password lost 2026-11-05) is not used any more.
$signingEnv = 'C:\Users\Johnathan\android-tools\kiosk-signing.env'
if (-not $env:SARCAFE_KIOSK_KS_PASS -and (Test-Path $signingEnv)) {
    foreach ($line in Get-Content $signingEnv) {
        if ($line -match '^\s*([A-Z_]+)=(.*)$' -and -not $line.TrimStart().StartsWith('#')) {
            Set-Item -Path "env:$($Matches[1])" -Value $Matches[2].Trim()
        }
    }
}
$keystore = if ($env:SARCAFE_KIOSK_KEYSTORE) { $env:SARCAFE_KIOSK_KEYSTORE } else { 'C:\Users\Johnathan\android-tools\sarcafe-kiosk-v2.keystore' }
$alias = if ($env:SARCAFE_KIOSK_KS_ALIAS) { $env:SARCAFE_KIOSK_KS_ALIAS } else { 'sarcafe-kiosk' }
# Checked first, so a build never runs for minutes and then fails at signing.
if (-not $env:SARCAFE_KIOSK_KS_PASS) {
    throw "SARCAFE_KIOSK_KS_PASS is not set and $signingEnv was not found: the signing password is not stored in the repo."
}

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force "$out\assets", "$out\classes", "$out\dex" | Out-Null

# The page that ships inside the app: prototype + kiosk layers + font + images, kept flat (aapt2 on Windows stores
# sub-folder assets with backslashes, which Android cannot open), paths rewritten, Google Fonts links removed, layers
# injected in order. scripts/assemble-kiosk-bundle.mjs does all of it: the over-the-air update publishes the same
# bundle and scripts/check-kiosk-session.mjs tests it, so the order of the layers lives there, not here.
Run node (Join-Path $root '..\..\scripts\assemble-kiosk-bundle.mjs') "$out\assets"

Run "$bt\aapt2.exe" compile --dir "$root\res" -o "$out\res.zip"
Run "$bt\aapt2.exe" link -o "$out\base.apk" -I $aj --manifest "$root\AndroidManifest.xml" `
    --min-sdk-version 24 --target-sdk-version 30 --version-code $VersionCode --version-name $VersionName `
    -A "$out\assets" "$out\res.zip"

$srcs = Get-ChildItem "$root\src" -Recurse -Filter *.java | ForEach-Object FullName
Run "$jdk\bin\javac.exe" --release 8 -encoding UTF-8 '-Xlint:-options' -classpath $aj -d "$out\classes" $srcs

$classes = Get-ChildItem "$out\classes" -Recurse -Filter *.class | ForEach-Object FullName
Run "$bt\d8.bat" --lib $aj --min-api 24 --release --output "$out\dex" $classes

Push-Location "$out\dex"
Run "$jdk\bin\jar.exe" uf "$out\base.apk" classes.dex
Pop-Location

Run "$bt\zipalign.exe" -f -p 4 "$out\base.apk" "$out\aligned.apk"

# apksigner and keytool read the password from the variable themselves (env: / :env), so it is on no command line.
if (-not (Test-Path $keystore)) {
    # the quotes keep PowerShell from reading "-storepass:env" as a parameter with a value
    Run "$jdk\bin\keytool.exe" -genkeypair -keystore $keystore '-storepass:env' SARCAFE_KIOSK_KS_PASS '-keypass:env' SARCAFE_KIOSK_KS_PASS `
        -alias $alias -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Sarcafe Kiosk'
}
Run "$bt\apksigner.bat" sign --ks $keystore --ks-key-alias $alias --ks-pass env:SARCAFE_KIOSK_KS_PASS --key-pass env:SARCAFE_KIOSK_KS_PASS `
    --out "$out\sarcafe-kiosk.apk" "$out\aligned.apk"
Run "$bt\apksigner.bat" verify --verbose "$out\sarcafe-kiosk.apk"

Write-Host "BUILT: $out\sarcafe-kiosk.apk ($([math]::Round((Get-Item "$out\sarcafe-kiosk.apk").Length/1KB)) KB)"
