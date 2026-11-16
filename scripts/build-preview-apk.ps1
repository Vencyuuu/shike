param(
    [string]$GradleCommand = '.expo/tools/gradle-9.4.1/bin/gradle.bat',
    [string]$Architectures = 'arm64-v8a,x86_64'
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$workspace = (Get-Location).Path

# 必须从业务源码构建，避免再次误用旧版预编译字节码。
foreach ($source in @('App.js', 'index.ts', 'android/app/build.gradle')) {
    if (-not (Test-Path -LiteralPath $source)) { throw "缺少构建输入：$source" }
}
$nativeBuildPath = Join-Path $workspace 'android/app/build.gradle'
$nativeBuild = Get-Content -LiteralPath $nativeBuildPath -Raw
if ($nativeBuild.Contains('SHIKE_PREBUILT_BUNDLE')) {
    throw '检测到旧版字节码复用规则。请移除后从实际源码构建。'
}

# SDK 内置旧 Ninja 存在 Windows 长路径问题，使用已准备的官方新版。
$ninjaPath = (Join-Path $workspace '.expo/ninja/ninja.exe').Replace('\', '/')
if (-not (Test-Path -LiteralPath $ninjaPath)) { throw '请先准备 Ninja 1.13.2 或更新版本。' }
if (-not $nativeBuild.Contains('CMAKE_MAKE_PROGRAM=')) {
    @"

// 使用支持 Windows 长路径的新版 Ninja。
android {
    defaultConfig {
        externalNativeBuild {
            cmake {
                arguments "-DCMAKE_MAKE_PROGRAM=$ninjaPath"
            }
        }
    }
}
"@ | Add-Content -LiteralPath $nativeBuildPath -Encoding utf8
}

$env:GRADLE_USER_HOME = Join-Path $workspace '.expo/gradle-cache'
$env:TEMP = Join-Path $workspace '.expo/build-temp'
$env:TMP = $env:TEMP
$env:CI = '1'
New-Item -ItemType Directory -Force $env:TEMP | Out-Null
$gradleArguments = @(
    '-p', 'android', ':app:assembleRelease',
    '--project-cache-dir', (Join-Path $workspace '.expo/apk-project-cache'),
    "-PreactNativeArchitectures=$Architectures", '--no-daemon', '--max-workers=4'
)
if ($env:HTTPS_PROXY) {
    $proxyAddress = [uri]$env:HTTPS_PROXY
    $gradleArguments += @(
        "-Dhttps.proxyHost=$($proxyAddress.Host)", "-Dhttps.proxyPort=$($proxyAddress.Port)",
        "-Dhttp.proxyHost=$($proxyAddress.Host)", "-Dhttp.proxyPort=$($proxyAddress.Port)"
    )
}
& $GradleCommand @gradleArguments
if ($LASTEXITCODE -ne 0) { throw 'Android 安装包构建失败。' }

# 对照本次源码生成的字节码校验 APK，防止交付缓存错包或占位入口。
$builtApk = Join-Path $workspace 'android/app/build/outputs/apk/release/app-release.apk'
$bundle = Join-Path $workspace 'android/app/build/generated/assets/react/release/index.android.bundle'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($builtApk)
try {
    $entry = $archive.GetEntry('assets/index.android.bundle')
    if (-not $entry) { throw 'APK 缺少业务字节码。' }
    $stream = $entry.Open()
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        $containedHash = [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '')
    } finally { $stream.Dispose(); $algorithm.Dispose() }
    if ($containedHash -ne (Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash) {
        throw 'APK 与本次源码构建结果不一致，不能交付。'
    }
} finally { $archive.Dispose() }

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$output = Join-Path $workspace 'artifacts'
New-Item -ItemType Directory -Force $output | Out-Null
$apk = Join-Path $output "Shike-$version-preview.apk"
Copy-Item -LiteralPath $builtApk -Destination $apk -Force
$hash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash
"$hash  $([System.IO.Path]::GetFileName($apk))" | Set-Content -LiteralPath "$apk.sha256" -Encoding ascii
Write-Host "安装包：$apk"
