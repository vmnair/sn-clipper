package com.sn_clipper

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import android.graphics.BitmapRegionDecoder
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Rect
import java.io.FileOutputStream
import java.io.File

class ImageCropModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String {
        return "ImageCropModule"
    }

    @ReactMethod
    fun cropImage(sourcePath: String, x: Int, y: Int, width: Int, height: Int, destPath: String, promise: Promise) {
        try {
            val cleanSourcePath = if (sourcePath.startsWith("file://")) sourcePath.substring(7) else sourcePath
            val cleanDestPath = if (destPath.startsWith("file://")) destPath.substring(7) else destPath

            val file = File(cleanSourcePath)
            if (!file.exists()) {
                promise.reject("FILE_NOT_FOUND", "Source file does not exist: $cleanSourcePath")
                return
            }

            // Decode dimensions first to clamp coordinates
            val options = BitmapFactory.Options().apply {
                inJustDecodeBounds = true
            }
            BitmapFactory.decodeFile(cleanSourcePath, options)
            val imgWidth = options.outWidth
            val imgHeight = options.outHeight

            if (imgWidth <= 0 || imgHeight <= 0) {
                promise.reject("INVALID_IMAGE", "Invalid image dimensions")
                return
            }

            // Clamp coordinates to image dimensions
            val left = Math.max(0, Math.min(x, imgWidth))
            val top = Math.max(0, Math.min(y, imgHeight))
            val right = Math.max(0, Math.min(x + width, imgWidth))
            val bottom = Math.max(0, Math.min(y + height, imgHeight))

            if (right - left <= 0 || bottom - top <= 0) {
                promise.reject("INVALID_BOUNDS", "Invalid crop coordinates: left=$left, top=$top, right=$right, bottom=$bottom")
                return
            }

            val cropRect = Rect(left, top, right, bottom)
            
            // Decode only the region
            val decoder = BitmapRegionDecoder.newInstance(cleanSourcePath, false)
            val croppedBitmap = decoder.decodeRegion(cropRect, null)
            decoder.recycle()

            if (croppedBitmap == null) {
                promise.reject("CROP_FAILED", "Failed to decode cropped region")
                return
            }

            // Automatically trim whitespace/empty margins from the cropped image
            val trimmedBitmap = trimWhitespace(croppedBitmap)
            if (trimmedBitmap != croppedBitmap) {
                croppedBitmap.recycle()
            }

            // Save cropped bitmap
            val destFile = File(cleanDestPath)
            destFile.parentFile?.mkdirs()
            val out = FileOutputStream(destFile)
            trimmedBitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            out.flush()
            out.close()

            trimmedBitmap.recycle()

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message, e)
        }
    }

    private fun trimWhitespace(bmp: Bitmap): Bitmap {
        val imgHeight = bmp.height
        val imgWidth = bmp.width
        var top = 0
        var left = 0
        var right = imgWidth - 1
        var bottom = imgHeight - 1

        fun isWhitespace(color: Int): Boolean {
            val r = (color shr 16) and 0xff
            val g = (color shr 8) and 0xff
            val b = color and 0xff
            return r > 245 && g > 245 && b > 245
        }

        // Scan top rows
        for (y in 0 until imgHeight) {
            var rowIsWhite = true
            for (x in 0 until imgWidth) {
                if (!isWhitespace(bmp.getPixel(x, y))) {
                    rowIsWhite = false
                    break
                }
            }
            if (!rowIsWhite) {
                top = y
                break
            }
        }

        // Scan bottom rows
        for (y in imgHeight - 1 downTo top) {
            var rowIsWhite = true
            for (x in 0 until imgWidth) {
                if (!isWhitespace(bmp.getPixel(x, y))) {
                    rowIsWhite = false
                    break
                }
            }
            if (!rowIsWhite) {
                bottom = y
                break
            }
        }

        // Scan left columns
        for (x in 0 until imgWidth) {
            var colIsWhite = true
            for (y in top..bottom) {
                if (!isWhitespace(bmp.getPixel(x, y))) {
                    colIsWhite = false
                    break
                }
            }
            if (!colIsWhite) {
                left = x
                break
            }
        }

        // Scan right columns
        for (x in imgWidth - 1 downTo left) {
            var colIsWhite = true
            for (y in top..bottom) {
                if (!isWhitespace(bmp.getPixel(x, y))) {
                    colIsWhite = false
                    break
                }
            }
            if (!colIsWhite) {
                right = x
                break
            }
        }

        val pad = 4
        val newLeft = Math.max(0, left - pad)
        val newTop = Math.max(0, top - pad)
        val newRight = Math.min(imgWidth - 1, right + pad)
        val newBottom = Math.min(imgHeight - 1, bottom + pad)

        val newWidth = newRight - newLeft + 1
        val newHeight = newBottom - newTop + 1

        if (newWidth <= 0 || newHeight <= 0 || (newWidth == imgWidth && newHeight == imgHeight)) {
            return bmp
        }

        return Bitmap.createBitmap(bmp, newLeft, newTop, newWidth, newHeight)
    }

    private fun sendEvent(eventName: String, params: String) {
        try {
            reactApplicationContext
                .getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        } catch (e: Exception) {
            // Ignore if JS context not ready
        }
    }

    companion object {
        @JvmStatic
        var launchMode: String = "normal"

        @JvmStatic
        var promptText: String = ""

        @JvmStatic
        var foregroundInstance: ImageCropModule? = null
    }

    @ReactMethod
    fun registerAsForeground(promise: Promise) {
        foregroundInstance = this
        promise.resolve(true)
    }

    @ReactMethod
    fun setLaunchMode(mode: String, promise: Promise) {
        launchMode = mode
        foregroundInstance?.sendEvent("onLaunchModeChange", mode)
        promise.resolve(true)
    }

    @ReactMethod
    fun getLaunchMode(promise: Promise) {
        promise.resolve(launchMode)
    }

    @ReactMethod
    fun setPromptText(text: String, promise: Promise) {
        promptText = text
        promise.resolve(true)
    }

    @ReactMethod
    fun getPromptText(promise: Promise) {
        promise.resolve(promptText)
    }
}
