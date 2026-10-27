# Builds the Sarcafe kiosk APK with the Android SDK command-line tools only (no Gradle, no downloads).
# Output goes outside the repo. Run from anywhere:  powershell -File build.ps1
# Windows PowerShell 5.1 turns any stderr line (javac notes) into an error under 'Stop', so each native
# call is checked by exit code instead.
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
$keystore = 'C:\Users\Johnathan\android-tools\sarcafe-kiosk.keystore'
$page   = Join-Path $root '..\sarcafe-kiosk'

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force "$out\assets", "$out\classes", "$out\dex" | Out-Null

# the page that ships inside the app
Copy-Item "$page\*" "$out\assets" -Recurse -Include *.html, *.css, *.js

# The prototype points at ../../public/..; inside the app the images sit next to index.html. They are kept
# flat on purpose: aapt2 on Windows stores sub-folder assets with backslashes, which Android cannot open.
$pub = Join-Path $root '..\..\public'
Copy-Item "$pub\sarcafe-logo.png" "$out\assets\"
Copy-Item "$pub\backdrops\givat-haviva-*.webp" "$out\assets\"
$utf8 = New-Object System.Text.UTF8Encoding($false)
Copy-Item "$root\overrides\*" "$out\assets"
Copy-Item "$root\fonts\*" "$out\assets"   # Rubik, so the page looks the same offline
foreach ($f in Get-ChildItem "$out\assets" -Filter *.html) {
    $t = [IO.File]::ReadAllText($f.FullName, $utf8).Replace('../../public/backdrops/', './').Replace('../../public/', './')
    # no outside font requests: the fonts are bundled
    $t = [regex]::Replace($t, '<link[^>]*fonts\.g(oogleapis|static)\.com[^>]*>\s*', '')
    if ($f.Name -eq 'index.html') {
        # kiosk-only layer: bundled font, real full-screen layout, numeric phone keypad, keyboard handling,
        # the last menu the dashboard pushed, the inactivity timer, and the menu-update listener
        $t = $t.Replace('</head>', '    <link rel="stylesheet" href="./rubik.css" />' + "`n" + '    <link rel="stylesheet" href="./kiosk-app.css" />' + "`n  </head>")
        $t = $t.Replace('<script src="./menu-data.js"></script>', '<script src="./menu-data.js"></script>' + "`n" + '    <script src="./kiosk-menu-cache.js"></script>')
        $t = $t.Replace('</body>', '    <script src="./kiosk-app.js"></script>' + "`n" + '    <script src="./kiosk-idle.js"></script>' + "`n" + '    <script src="./kiosk-sync.js"></script>' + "`n  </body>")
    }
    [IO.File]::WriteAllText($f.FullName, $t, $utf8)
}

Run "$bt\aapt2.exe" compile --dir "$root\res" -o "$out\res.zip"
Run "$bt\aapt2.exe" link -o "$out\base.apk" -I $aj --manifest "$root\AndroidManifest.xml" `
    --min-sdk-version 24 --target-sdk-version 30 --version-code 1 --version-name 0.1 `
    -A "$out\assets" "$out\res.zip"

$srcs = Get-ChildItem "$root\src" -Recurse -Filter *.java | ForEach-Object FullName
Run "$jdk\bin\javac.exe" --release 8 -encoding UTF-8 '-Xlint:-options' -classpath $aj -d "$out\classes" $srcs

$classes = Get-ChildItem "$out\classes" -Recurse -Filter *.class | ForEach-Object FullName
Run "$bt\d8.bat" --lib $aj --min-api 24 --release --output "$out\dex" $classes

Push-Location "$out\dex"
Run "$jdk\bin\jar.exe" uf "$out\base.apk" classes.dex
Pop-Location

Run "$bt\zipalign.exe" -f -p 4 "$out\base.apk" "$out\aligned.apk"

if (-not (Test-Path $keystore)) {
    Run "$jdk\bin\keytool.exe" -genkeypair -keystore $keystore -storepass android -keypass android `
        -alias sarcafe-kiosk -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Sarcafe Kiosk'
}
Run "$bt\apksigner.bat" sign --ks $keystore --ks-pass pass:android --key-pass pass:android `
    --out "$out\sarcafe-kiosk.apk" "$out\aligned.apk"
Run "$bt\apksigner.bat" verify --verbose "$out\sarcafe-kiosk.apk"

Write-Host "BUILT: $out\sarcafe-kiosk.apk ($([math]::Round((Get-Item "$out\sarcafe-kiosk.apk").Length/1KB)) KB)"
