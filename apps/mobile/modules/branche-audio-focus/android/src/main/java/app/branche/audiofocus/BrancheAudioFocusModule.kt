package app.branche.audiofocus

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Focus audio des annonces de guidage (Android) : demandé avant chaque annonce (usage « guidage de navigation »,
 * AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK : la musique des autres apps est atténuée), rendu à la fin de l'annonce.
 * Aucune permission requise. La voix elle-même reste produite par expo-speech.
 */
class BrancheAudioFocusModule : Module() {
  private var focusRequest: AudioFocusRequest? = null
  private val focusListener = AudioManager.OnAudioFocusChangeListener { }

  private fun audioManager(): AudioManager? =
    appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  override fun definition() = ModuleDefinition {
    Name("BrancheAudioFocus")

    Function("duck") {
      requestDuck()
    }

    Function("release") {
      abandon()
    }
  }

  @Suppress("DEPRECATION")
  private fun requestDuck(): Boolean {
    val am = audioManager() ?: return false
    val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
      val req = focusRequest ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(attrs)
        .setOnAudioFocusChangeListener(focusListener)
        .build()
      focusRequest = req
      am.requestAudioFocus(req)
    } else {
      am.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
    }
    return result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
  }

  @Suppress("DEPRECATION")
  private fun abandon(): Boolean {
    val am = audioManager() ?: return false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val req = focusRequest ?: return true
      am.abandonAudioFocusRequest(req)
    } else {
      am.abandonAudioFocus(focusListener)
    }
    return true
  }
}
