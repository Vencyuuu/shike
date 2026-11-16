package cn.shike.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.amap.api.services.core.AMapException
import com.amap.api.services.core.LatLonPoint
import com.amap.api.services.core.PoiItem
import com.amap.api.services.core.ServiceSettings
import com.amap.api.services.poisearch.PoiResult
import com.amap.api.services.poisearch.PoiSearch
import com.facebook.react.bridge.*

/** 周边搜索与定位共用 Android Key；仅同意说明后按需创建搜索请求。 */
class AmapPoiModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context), LifecycleEventListener {
  companion object { const val NAME = "ShikeAmapPlaces" }
  private val handler = Handler(Looper.getMainLooper())
  private var pending: Promise? = null
  private var search: PoiSearch? = null
  private var timeout: Runnable? = null
  private var generation = 0L
  init { context.addLifecycleEventListener(this) }
  override fun getName() = NAME

  @ReactMethod
  fun searchNearby(latitude: Double, longitude: Double, keyword: String, promise: Promise) {
    handler.post {
      val preferences = context.getSharedPreferences("shike_amap_privacy", Context.MODE_PRIVATE)
      if (!preferences.getBoolean("agreed", false) || preferences.getInt("consent_version", 0) != 2) {
        promise.reject("E_PRIVACY_REQUIRED", "请先同意高德定位与地点搜索说明")
        return@post
      }
      if (!latitude.isFinite() || latitude !in -90.0..90.0 ||
        !longitude.isFinite() || longitude !in -180.0..180.0) {
        promise.reject("E_INVALID_COORDINATE", "搜索中心坐标无效")
        return@post
      }
      rejectPending("E_LOCATION_CANCELLED", "已开始新的地点搜索")
      val token = ++generation
      pending = promise
      try {
        ServiceSettings.updatePrivacyShow(context, true, true)
        ServiceSettings.updatePrivacyAgree(context, true)
        ServiceSettings.getInstance().setProtocol(ServiceSettings.HTTPS)
        val query = PoiSearch.Query(keyword.trim().take(60), "", "").apply {
          setPageSize(20)
          setPageNum(0)
          setDistanceSort(true)
        }
        val active = PoiSearch(context, query)
        search = active
        active.setBound(PoiSearch.SearchBound(LatLonPoint(latitude, longitude), 2000, true))
        active.setOnPoiSearchListener(object : PoiSearch.OnPoiSearchListener {
          override fun onPoiSearched(result: PoiResult?, code: Int) {
            handler.post resultCallback@{
              if (token != generation || pending == null) return@resultCallback
              if (code != AMapException.CODE_AMAP_SUCCESS) {
                rejectPending("E_AMAP_POI_$code", "附近地点搜索暂不可用（高德错误码 $code），可重试或使用当前位置")
                return@resultCallback
              }
              val places = Arguments.createArray()
              for (item in result?.pois.orEmpty()) {
                val point = item.latLonPoint ?: continue
                places.pushMap(Arguments.createMap().apply {
                  putString("id", item.poiId)
                  putString("title", item.title)
                  putString("address", listOf(item.cityName, item.adName, item.snippet)
                    .filterNotNull().filter { it.isNotBlank() }.distinct().joinToString(" "))
                  putDouble("latitude", point.latitude)
                  putDouble("longitude", point.longitude)
                  putInt("distance", item.distance)
                })
              }
              val completion = pending
              cleanup()
              completion?.resolve(places)
            }
          }
          override fun onPoiItemSearched(item: PoiItem?, code: Int) = Unit
        })
        timeout = Runnable {
          if (token == generation) rejectPending("E_POI_TIMEOUT", "附近地点搜索超时，请重试或使用当前位置")
        }.also { handler.postDelayed(it, 15000L) }
        active.searchPOIAsyn()
      } catch (error: Exception) {
        rejectPending("E_POI_INIT", "暂时无法搜索附近地点，请重试")
      }
    }
  }

  @ReactMethod
  fun cancel(promise: Promise) {
    handler.post {
      rejectPending("E_LOCATION_CANCELLED", "已取消地点搜索")
      promise.resolve(null)
    }
  }
  private fun cleanup() {
    generation++
    timeout?.let { handler.removeCallbacks(it) }
    timeout = null
    // SDK 没有取消 HTTP 的接口；移除监听并让过期回调失效，避免旧结果覆盖新搜索。
    try { search?.setOnPoiSearchListener(null) } catch (_: Exception) { /* 仍需使过期请求失效。 */ }
    search = null
    pending = null
  }
  private fun rejectPending(code: String, message: String) {
    val completion = pending
    cleanup()
    completion?.reject(code, message)
  }
  override fun onHostResume() = Unit
  override fun onHostPause() { handler.post { rejectPending("E_LOCATION_CANCELLED", "应用已离开前台") } }
  override fun onHostDestroy() { handler.post { rejectPending("E_LOCATION_CANCELLED", "页面已关闭") } }
  override fun invalidate() {
    context.removeLifecycleEventListener(this)
    handler.post { rejectPending("E_LOCATION_CANCELLED", "模块已释放") }
    super.invalidate()
  }
}
