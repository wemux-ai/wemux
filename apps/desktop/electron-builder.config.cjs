const path = require('node:path')
const { readFileSync } = require('node:fs')

const repoRoot = path.resolve(__dirname, '../..')
const productPackage = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const runtimeBinary = process.platform === 'win32'
  ? path.join(repoRoot, 'apps/meeting-runtime/native/build/Release/wemux-meeting-runtime.exe')
  : path.join(repoRoot, 'apps/meeting-runtime/native/build/wemux-meeting-runtime')
const shouldNotarize = Boolean(
  process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID,
)
// Community builds run unsigned when no certificate secret is provided.
// Signing is enabled per-platform by CSC_* secrets in native-release.yml.
const shouldSignMac = Boolean(process.env.CSC_LINK || process.env.MACOS_CERTIFICATE)

module.exports = {
  appId: 'com.wemux.app',
  productName: 'Wemux',
  // 包名是 scoped（@wemux/desktop），electron-builder 会拿它当可执行文件名，
  // '@' 和 '/' 在 AppImage 路径里不合法 —— 显式指定安全名称。
  executableName: 'wemux-desktop',
  extraMetadata: {
    version: productPackage.version,
    description: 'Wemux desktop client',
  },
  directories: {
    output: 'dist',
    buildResources: 'assets/icons',
  },
  files: [
    'src/main.mjs',
    'src/preload.cjs',
    'package.json',
  ],
  extraResources: [
    {
      from: '../web/native-static',
      to: 'web',
    },
    {
      from: 'assets/icons/icon.png',
      to: 'icon.png',
    },
    {
      from: runtimeBinary,
      to: `meeting-runtime/${path.basename(runtimeBinary)}`,
    },
  ],
  protocols: [
    {
      name: 'Wemux deep link',
      schemes: ['wemux'],
    },
  ],
  asar: true,
  npmRebuild: false,
  publish: [
    {
      provider: 'github',
      owner: 'wemux-ai',
      repo: 'wemux',
    },
  ],
  mac: {
    category: 'public.app-category.productivity',
    icon: 'assets/icons/icon.icns',
    identity: shouldSignMac ? undefined : null,
    minimumSystemVersion: '10.15',
    extendInfo: {
      NSMicrophoneUsageDescription: 'Wemux uses the microphone for local meeting transcription.',
    },
    notarize: shouldNotarize,
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
  },
  dmg: {
    artifactName: '${productName}-${version}-${arch}.${ext}',
  },
  win: {
    icon: 'assets/icons/icon.ico',
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: '${productName}-${version}-${arch}-setup.${ext}',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
  linux: {
    icon: 'assets/icons/icon.png',
    category: 'Development',
    target: [{ target: 'AppImage', arch: ['x64'] }],
    artifactName: '${productName}-${version}-${arch}.${ext}',
  },
}
