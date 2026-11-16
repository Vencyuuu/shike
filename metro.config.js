const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);

// 使用与 React Native 兼容的本地加密适配，避免打包时错误解析 Node crypto。
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@noble/hashes/crypto' || moduleName === '@noble/hashes/crypto.js') {
    return {
      filePath: path.join(path.dirname(require.resolve('@noble/hashes/sha256')), 'crypto.js'),
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
