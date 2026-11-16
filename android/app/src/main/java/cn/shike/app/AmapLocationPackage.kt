package cn.shike.app

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** 使用惰性模块注册，应用启动时不创建高德定位客户端。 */
class AmapLocationPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    when (name) {
      AmapLocationModule.NAME -> AmapLocationModule(reactContext)
      AmapPoiModule.NAME -> AmapPoiModule(reactContext)
      PhotoStorageModule.NAME -> PhotoStorageModule(reactContext)
      else -> null
    }

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(AmapLocationModule.NAME to ReactModuleInfo(
      AmapLocationModule.NAME, AmapLocationModule.NAME,
      false, false, false, false
    ), AmapPoiModule.NAME to ReactModuleInfo(
      AmapPoiModule.NAME, AmapPoiModule.NAME, false, false, false, false
    ), PhotoStorageModule.NAME to ReactModuleInfo(
      PhotoStorageModule.NAME, PhotoStorageModule.NAME, false, false, false, false
    ))
  }
}
