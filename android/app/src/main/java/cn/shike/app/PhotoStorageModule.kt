package cn.shike.app

import android.app.Activity
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.MediaStore
import com.facebook.react.bridge.*
import java.io.File
import java.util.concurrent.Executors

/** 原片通过系统授权目录或 MediaStore 保存，应用自己的相册副本仍在私有目录。 */
class PhotoStorageModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context), ActivityEventListener {
  companion object {
    const val NAME = "ShikePhotoStorage"
    private const val PICK_PHOTOS = 4811
    private const val PICK_FOLDER = 4812
    private const val DELETE_MEDIA = 4813
  }
  private val resolver get() = context.contentResolver
  private val preferences = context.getSharedPreferences("shike_photos", Context.MODE_PRIVATE)
  private val worker = Executors.newSingleThreadExecutor()
  private var pending: Promise? = null
  private var deletion: List<Uri> = emptyList()

  init { context.addActivityEventListener(this) }
  override fun getName() = NAME

  private fun description(): String {
    val tree = preferences.getString("tree", null)
    return if (tree == null) "系统相册 / Pictures / Shike"
    else "自选目录：${DocumentsContract.getTreeDocumentId(Uri.parse(tree))}"
  }

  @ReactMethod
  fun getFolder(promise: Promise) { promise.resolve(description()) }

  @ReactMethod
  fun resetFolder(promise: Promise) {
    preferences.edit().remove("tree").apply()
    promise.resolve(description())
  }

  /** SAF 的授权来自系统目录选择器，不索取整个磁盘的管理权限。 */
  @ReactMethod
  fun chooseFolder(promise: Promise) {
    launch(PICK_FOLDER, Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
    }, promise)
  }

  /** 保留真实文档 URI；不再依赖 Photo Picker 经常缺失的 assetId。 */
  @ReactMethod
  fun pickPhotos(multiple: Boolean, promise: Promise) {
    launch(PICK_PHOTOS, Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      type = "image/*"
      addCategory(Intent.CATEGORY_OPENABLE)
      putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    }, promise)
  }

  private fun launch(code: Int, intent: Intent, promise: Promise) {
    context.runOnUiQueueThread {
      val activity = context.currentActivity
      if (pending != null || activity == null) {
        promise.reject("BUSY", "系统选择器尚未关闭，请稍后重试")
      } else {
        pending = promise
        try { activity.startActivityForResult(intent, code) }
        catch (error: Exception) { pending = null; promise.reject("PICKER", error.message, error) }
      }
    }
  }

  /** 保存的是相机原片，不是已缩小的应用展示副本；出错不会静默切换到其他目录。 */
  @ReactMethod
  fun saveCapture(source: String, name: String, promise: Promise) {
    worker.execute {
      var destination: Uri? = null
      try {
        require(name.matches(Regex("[A-Za-z0-9_-]+\\.jpg")))
        val file = File(Uri.parse(source).path ?: error("原片地址无效"))
        require(file.canonicalPath.startsWith(context.cacheDir.canonicalPath + File.separator))
        require(file.length() > 0)
        val tree = preferences.getString("tree", null)
        destination = if (tree != null) {
          val treeUri = Uri.parse(tree)
          val parent = DocumentsContract.buildDocumentUriUsingTree(
            treeUri, DocumentsContract.getTreeDocumentId(treeUri))
          DocumentsContract.createDocument(resolver, parent, "image/jpeg", name)
        } else {
          resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, name)
            put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
            if (Build.VERSION.SDK_INT >= 29) {
              put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Shike")
              put(MediaStore.Images.Media.IS_PENDING, 1)
            } else {
              val folder = File(Environment.getExternalStoragePublicDirectory(
                Environment.DIRECTORY_PICTURES), "Shike")
              check(folder.isDirectory || folder.mkdirs()) { "无法创建相册目录" }
              put(MediaStore.Images.Media.DATA, File(folder, name).absolutePath)
            }
          })
        }
        val outputUri = destination ?: error("无法创建原片文件")
        file.inputStream().use { input ->
          (resolver.openOutputStream(outputUri, "w") ?: error("目录不可写")).use { output ->
            input.copyTo(output)
          }
        }
        if (tree == null && Build.VERSION.SDK_INT >= 29) resolver.update(outputUri, ContentValues().apply {
          put(MediaStore.Images.Media.IS_PENDING, 0)
        }, null, null)
        promise.resolve(outputUri.toString())
      } catch (error: Exception) {
        destination?.let { runCatching { eraseDocument(it) } }
        promise.reject("SAVE_PHOTO", "原片保存失败，请检查目录授权与剩余空间：${error.message}", error)
      }
    }
  }

  /** MediaStore 文档只从官方文档 ID 映射，不以任意文件名猜测原图。 */
  private fun mediaUri(uri: Uri): Uri? {
    if (uri.authority == "media") return uri
    if (uri.authority == "com.android.providers.media.documents") {
      val id = DocumentsContract.getDocumentId(uri)
      if (id.startsWith("image:")) return ContentUris.withAppendedId(
        MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id.substringAfter(':').toLong())
    }
    return null
  }

  private fun eraseDocument(uri: Uri) {
    if (DocumentsContract.isDocumentUri(context, uri)) {
      check(DocumentsContract.deleteDocument(resolver, uri)) { "源文件未删除" }
    } else check(resolver.delete(uri, null, null) > 0) { "源文件不存在或无删除权限" }
  }

  /** Android 11+ 由系统针对所选原图确认删除，不申请全相册读写权限。 */
  @ReactMethod
  fun deleteSources(values: ReadableArray, promise: Promise) {
    val uris = (0 until values.size()).map { Uri.parse(values.getString(it)) }.distinct()
    if (uris.isEmpty() || uris.any { it.scheme != "content" }) {
      promise.reject("SOURCE", "源文件引用不可用"); return
    }
    worker.execute {
      try {
        val media = uris.mapNotNull { mediaUri(it) }
        // 先询问系统，用户取消时不会删除其他文档来源，也不会移除应用记录。
        if (media.isNotEmpty() && Build.VERSION.SDK_INT >= 30) {
          context.runOnUiQueueThread {
            val activity = context.currentActivity
            if (activity == null || pending != null) promise.reject("BUSY", "请稍后重试")
            else try {
              pending = promise
              deletion = uris.filter { mediaUri(it) == null }
              val request = MediaStore.createDeleteRequest(resolver, media)
              activity.startIntentSenderForResult(request.intentSender, DELETE_MEDIA, null, 0, 0, 0)
            } catch (error: Exception) {
              pending = null; deletion = emptyList(); promise.reject("DELETE", error.message, error)
            }
          }
        } else deleteDocuments(uris, promise)
      } catch (error: Exception) { promise.reject("DELETE", error.message, error) }
    }
  }

  private fun deleteDocuments(uris: List<Uri>, promise: Promise) {
    try {
      uris.forEach { eraseDocument(it) }
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("DELETE", "部分源文件未能删除，应用记录已保留；可取消勾选后仅删除记录。${error.message}", error)
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode !in listOf(PICK_PHOTOS, PICK_FOLDER, DELETE_MEDIA)) return
    val promise = pending ?: return
    pending = null
    if (requestCode == DELETE_MEDIA) {
      val documents = deletion; deletion = emptyList()
      if (resultCode != Activity.RESULT_OK) promise.reject("CANCELLED", "已取消删除源文件，应用记录已保留")
      else worker.execute { deleteDocuments(documents, promise) }
      return
    }
    if (resultCode != Activity.RESULT_OK || data == null) { promise.resolve(null); return }
    try {
      val flags = data.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      if (requestCode == PICK_FOLDER) {
        val uri = data.data ?: error("目录不可用")
        check(flags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION != 0) { "目录未授予写入权限" }
        resolver.takePersistableUriPermission(uri, flags)
        preferences.edit().putString("tree", uri.toString()).apply()
        promise.resolve(description())
      } else {
        val uris = data.clipData?.let { clip -> (0 until clip.itemCount).map { clip.getItemAt(it).uri } }
          ?: listOfNotNull(data.data)
        val result = Arguments.createArray()
        uris.distinct().forEach { uri ->
          runCatching { resolver.takePersistableUriPermission(uri, flags) }
          result.pushMap(Arguments.createMap().apply {
            putString("uri", uri.toString()); putString("assetId", uri.toString())
          })
        }
        promise.resolve(result)
      }
    } catch (error: Exception) { promise.reject("PICKER", error.message, error) }
  }
  override fun onNewIntent(intent: Intent) = Unit
  override fun invalidate() {
    context.removeActivityEventListener(this)
    pending?.reject("CLOSED", "页面已关闭")
    pending = null
    worker.shutdown()
    super.invalidate()
  }
}
