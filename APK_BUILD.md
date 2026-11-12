# Android 试用安装包构建

本次构建使用保留的 `dist/metadata.json` 及其指向的 Hermes 应用字节码。
业务字节码与先前 React Native 应用的构建产物一致，原生依赖版本来自现存的 `node_modules/`。

当前工作区业务源码、原生配置文件曾出现缺失，因此重新生成原生宿主并恢复了构建配置。
`index.ts` 仅用于生成宿主，不包含业务实现；在恢复完整源码前不能通过 Metro 开发模式启动。
不要将此入口当作完整源码交付。

构建脚本：`scripts/build-preview-apk.ps1`。

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-preview-apk.ps1
```

试用包为 ARM64、独立运行的 release 变体，使用 Android 模板测试签名。
不需要电脑上的 Metro 服务；适合 Android 7.0 及以上的 ARM64 手机。
构建完成：`artifacts/Shike-1.1.0-preview-arm64.apk`，30.7 MiB。

- 包名：`cn.shike.app`；版本：`1.1.0 (1)`。
- 最低 Android 7.0（API 24），原生架构为 `arm64-v8a`。
- APK Signature Scheme v2 签名校验通过。
- APK 内的应用字节码 SHA-256 与先前导出的真实应用包一致。
- 尚未进行真机安装与运行验收。

APK SHA-256：

```text
123CAE9F1EC783615FB28345D366188B2AC30FEABE905B7BC1691D242CE7B064
```

Windows 构建使用工作区中的 Gradle 9.4.1 与 Ninja 1.13.2，并通过独立项目缓存避开编辑器锁。
原生打包任务正常执行，输出既有字节码；不能直接使用 `-x` 跳过该任务。
