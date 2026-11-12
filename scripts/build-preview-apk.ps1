param(
    [string]$GradleCommand = '.expo/tools/gradle-9.4.1/bin/gradle.bat'
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

# 本次使用先前成功导出的真实应用字节码，不从缺失的源码重新生成界面。
$metadata = Get-Content -LiteralPath 'dist/metadata.json' -Raw | ConvertFrom-Json
$workspace = (Get-Location).Path
$bundle = [System.IO.Path]::GetFullPath((Join-Path $workspace $metadata.fileMetadata.android.bundle))
if (-not $bundle.StartsWith($workspace + [System.IO.Path]::DirectorySeparatorChar)) {
    throw '应用包路径必须位于当前工作区内。'
}
if (-not (Test-Path -LiteralPath $bundle)) { throw '缺少已导出的应用字节码。' }
if (-not (Test-Path -LiteralPath 'android/app/build.gradle')) {
    throw '请先执行 npx expo prebuild --platform android --no-install。'
}

# Windows 自带 SDK 中的旧 Ninja 不支持长路径，使用本次准备的官方新版工具。
$nativeBuildPath = Join-Path $workspace 'android/app/build.gradle'
$ninjaPath = (Join-Path $workspace '.expo/ninja/ninja.exe').Replace('\', '/')
if (-not (Test-Path -LiteralPath $ninjaPath)) { throw '请先准备 Ninja 1.13.2 或更新版本。' }
if (-not (Get-Content -LiteralPath $nativeBuildPath -Raw).Contains('CMAKE_MAKE_PROGRAM=')) {
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

# 注册一个正常完成的字节码输出任务，避免直接排除任务破坏 Gradle 输出依赖。
if (-not (Get-Content -LiteralPath $nativeBuildPath -Raw).Contains('SHIKE_PREBUILT_BUNDLE')) {
    @'

// SHIKE_PREBUILT_BUNDLE：复用已经导出的业务字节码。
apply from: rootProject.file('../scripts/prebuilt-bundle.gradle')
'@ | Add-Content -LiteralPath $nativeBuildPath -Encoding utf8
}
$legacyAsset = Join-Path $workspace 'android/app/src/main/assets/index.android.bundle'
if (Test-Path -LiteralPath $legacyAsset) {
    if ((Get-FileHash -LiteralPath $legacyAsset).Hash -ne (Get-FileHash -LiteralPath $bundle).Hash) {
        throw '主资源目录中存在不同的业务包，请先核对。'
    }
    Remove-Item -LiteralPath $legacyAsset -Force
}
$env:GRADLE_USER_HOME = Join-Path $workspace '.expo/gradle-cache'
$env:CI = '1'

# 使用独立运行的 release 变体，并由任务写入经过核对的既有业务字节码。
# 当前原生模板使用测试签名，仅用于安装体验，不作为商店发布版本。
$gradleArguments = @(
    '-p', 'android', 'assembleRelease',
    '--project-cache-dir', (Join-Path $workspace '.expo/apk-project-cache'),
    '-PreactNativeArchitectures=arm64-v8a',
    '--no-daemon', '--max-workers=4'
)
if ($env:HTTPS_PROXY) {
    $proxyAddress = [uri]$env:HTTPS_PROXY
    $gradleArguments += @(
        "-Dhttps.proxyHost=$($proxyAddress.Host)",
        "-Dhttps.proxyPort=$($proxyAddress.Port)",
        "-Dhttp.proxyHost=$($proxyAddress.Host)",
        "-Dhttp.proxyPort=$($proxyAddress.Port)"
    )
}
& $GradleCommand @gradleArguments
if ($LASTEXITCODE -ne 0) { throw 'Android 安装包构建失败。' }

$output = Join-Path $workspace 'artifacts'
New-Item -ItemType Directory -Force $output | Out-Null
$apk = Join-Path $output 'Shike-1.1.0-preview-arm64.apk'
$builtApk = Join-Path $workspace 'android/app/build/outputs/apk/release/app-release.apk'

# 交付前核对 APK 内的业务字节码，防止构建误用占位入口或其他旧包。
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($builtApk)
try {
    $entry = $archive.GetEntry('assets/index.android.bundle')
    if (-not $entry) { throw 'APK 缺少应用字节码，不能交付。' }
    $stream = $entry.Open()
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        $containedHash = [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '')
    } finally {
        $algorithm.Dispose()
        $stream.Dispose()
    }
    if ($containedHash -ne (Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash) {
        throw 'APK 内应用内容与已确认版本不一致，不能交付。'
    }
} finally {
    $archive.Dispose()
}
Copy-Item -LiteralPath $builtApk -Destination $apk -Force
Get-FileHash -LiteralPath $apk -Algorithm SHA256
Write-Host "安装包：$apk"
