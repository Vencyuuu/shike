package cn.shike.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.location.LocationManager
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import com.amap.api.location.AMapLocation
import com.amap.api.location.AMapLocationClient
import com.amap.api.location.AMapLocationClientOption
import com.amap.api.services.core.ServiceSettings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * 只提供一次前台定位。SDK 实例仅在用户同意说明且已授予系统权限后创建。
 * 所有 SDK 调用及结束操作在主线程串行执行，避免取消与回调同时结算 Promise。
 */
class AmapLocationModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context), LifecycleEventListener {

  companion object { const val NAME = "ShikeAmapLocation" }
  private val handler = Handler(Looper.getMainLooper())
  private val preferences = context.getSharedPreferences("shike_amap_privacy", Context.MODE_PRIVATE)
  private var client: AMapLocationClient? = null
  private var pending: Promise? = null
  private var timeout: Runnable? = null
  private var addressTimeout: Runnable? = null
  private var generation = 0L

  init { context.addLifecycleEventListener(this) }
  override fun getName() = NAME

  @ReactMethod
  fun isLocationEnabled(promise: Promise) {
    val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    promise.resolve(LocationManagerCompat.isLocationEnabled(manager))
  }

  @ReactMethod
  fun hasPrivacyConsent(promise: Promise) {
    promise.resolve(preferences.getBoolean("agreed", false) && preferences.getInt("consent_version", 0) == 2)
  }

  @ReactMethod
  fun setPrivacyConsent(agreed: Boolean, promise: Promise) {
    handler.post {
      if (!agreed) {
        cancelPending("E_LOCATION_CANCELLED", "已撤回高德定位同意")
        if (preferences.getBoolean("agreed", false)) {
          AMapLocationClient.updatePrivacyAgree(context, false)
          ServiceSettings.updatePrivacyAgree(context, false)
        }
      }
      preferences.edit().putBoolean("agreed", agreed).putInt("consent_version", if (agreed) 2 else 0).apply()
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun getCurrentLocation(promise: Promise) {
    handler.post {
      if (!preferences.getBoolean("agreed", false) || preferences.getInt("consent_version", 0) != 2) {
        promise.reject("E_PRIVACY_REQUIRED", "请先阅读并同意高德定位说明")
        return@post
      }
      val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
      val coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION)
      if (fine != PackageManager.PERMISSION_GRANTED && coarse != PackageManager.PERMISSION_GRANTED) {
        promise.reject("E_LOCATION_PERMISSION", "未获得定位权限，可不附加位置保存")
        return@post
      }
      cancelPending("E_LOCATION_CANCELLED", "已开始新的定位请求")
      val token = ++generation
      pending = promise
      try {
        // 此处的 true 对应 JS 层真实展示的高德说明和用户明确点击的同意。
        AMapLocationClient.updatePrivacyShow(context, true, true)
        AMapLocationClient.updatePrivacyAgree(context, true)
        val active = AMapLocationClient(context)
        client = active
        val options = AMapLocationClientOption().apply {
          setLocationMode(AMapLocationClientOption.AMapLocationMode.Hight_Accuracy)
          setOnceLocation(true)
          setOnceLocationLatest(true)
          setNeedAddress(true)
          setLocationCacheEnable(false)
          setHttpTimeOut(15000L)
          // 允许 Android 官方模拟位置提供器进行验收，不改变真实设备定位模式。
          setMockEnable(true)
        }
        AMapLocationClientOption.setLocationProtocol(
          AMapLocationClientOption.AMapLocationProtocol.HTTPS
        )
        active.setLocationOption(options)
        var resolvingAddress = false
        active.setLocationListener { location ->
          handler.post locationResult@{
            if (token != generation || pending == null || resolvingAddress) return@locationResult
            if (location == null) {
              cancelPending("E_LOCATION_UNAVAILABLE", "暂时无法获取位置，请重试或跳过")
              return@locationResult
            }
            if (location.errorCode != 0) {
              val message = if (location.errorCode == 7) {
                "高德 Key 鉴权失败，请核对 Android Key、包名与签名 SHA1（错误码 7）"
              } else {
                "高德定位失败（${location.errorCode}）：${location.errorInfo}。可重试或跳过。"
              }
              cancelPending("E_AMAP_${location.errorCode}", message)
              return@locationResult
            }
            val latitude = location.latitude
            val longitude = location.longitude
            if (!latitude.isFinite() || latitude !in -90.0..90.0 ||
              !longitude.isFinite() || longitude !in -180.0..180.0 ||
              kotlin.math.abs(System.currentTimeMillis() - location.time) > 60000L) {
              cancelPending("E_LOCATION_STALE", "未取得有效的当前位置，请重试")
              return@locationResult
            }
            if (location.address.isNullOrBlank()) {
              // GPS 成功可能不带地址，使用同一 Android SDK 的逆地理接口补充。
              // 地址失败仍返回有效坐标，四秒后兜底，避免网络问题阻碍餐次入档。
              resolvingAddress = true
              timeout?.let { handler.removeCallbacks(it) }
              timeout = null
              active.setReGeoLocationCallback { address ->
                handler.post {
                  if (token == generation && pending != null) {
                    if (address?.errorCode == 7) {
                      cancelPending("E_AMAP_7", "高德 Key 鉴权失败，请核对 Android Key、包名与签名 SHA1（错误码 7）")
                    } else {
                      finishLocation(location, address?.takeIf { it.errorCode == 0 } ?: location)
                    }
                  }
                }
              }
              addressTimeout = Runnable {
                if (token == generation && pending != null) finishLocation(location)
              }.also { handler.postDelayed(it, 4000L) }
              try { active.getReGeoLocation(location) }
              catch (_: Exception) { finishLocation(location) }
            } else {
              finishLocation(location)
            }
          }
        }
        timeout = Runnable {
          if (token == generation) cancelPending("E_LOCATION_TIMEOUT", "定位超时，请重试或不附加位置保存")
        }.also { handler.postDelayed(it, 20000L) }
        active.startLocation()
      } catch (error: Exception) {
        cancelPending("E_AMAP_INIT", "高德定位初始化失败，请稍后重试")
      }
    }
  }

  /** 地址回填只替换文字，始终保留原始定位的坐标、精度、时间与坐标系。 */
  private fun finishLocation(location: AMapLocation, address: AMapLocation = location) {
    val latitude = location.latitude
    val longitude = location.longitude
    val result = Arguments.createMap().apply {
      putDouble("latitude", latitude)
      putDouble("longitude", longitude)
      putDouble("accuracy", location.accuracy.toDouble())
      putDouble("timestamp", location.time.toDouble())
      putString("address", address.address.orEmpty())
      putString("poiName", address.poiName.orEmpty())
      putString("aoiName", address.aoiName.orEmpty())
      putString("provider", "amap")
      putString("coordinateSystem", when (location.coordType.orEmpty().uppercase()) {
        "GCJ02", "GCJ-02" -> "GCJ-02"
        "WGS84", "WGS-84" -> "WGS84"
        else -> "unknown"
      })
    }
    val completion = pending
    cleanup()
    completion?.resolve(result)
  }

  @ReactMethod
  fun cancel(promise: Promise) {
    handler.post {
      cancelPending("E_LOCATION_CANCELLED", "已取消定位")
      promise.resolve(null)
    }
  }

  /** 成功、失败、超时、取消和生命周期中断都通过同一出口释放资源。 */
  private fun cleanup() {
    generation++
    timeout?.let { handler.removeCallbacks(it) }
    timeout = null
    addressTimeout?.let { handler.removeCallbacks(it) }
    addressTimeout = null
    pending = null
    val active = client
    client = null
    try { active?.stopLocation() } catch (_: Exception) { /* 继续销毁实例。 */ }
    try { active?.onDestroy() } catch (_: Exception) { /* 客户端不再被持有。 */ }
  }

  private fun cancelPending(code: String, message: String) {
    val completion = pending
    cleanup()
    completion?.reject(code, message)
  }

  override fun onHostResume() = Unit
  override fun onHostPause() { handler.post { cancelPending("E_LOCATION_CANCELLED", "应用已离开前台") } }
  override fun onHostDestroy() { handler.post { cancelPending("E_LOCATION_CANCELLED", "页面已关闭") } }
  override fun invalidate() {
    context.removeLifecycleEventListener(this)
    handler.post { cancelPending("E_LOCATION_CANCELLED", "定位模块已释放") }
    super.invalidate()
  }
}
