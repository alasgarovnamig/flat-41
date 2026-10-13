package az.evtap.app.data

import android.content.Context
import android.util.Base64
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import az.evtap.app.ui.theme.ThemeMode
import az.evtap.core.api.EvTapJson
import com.google.crypto.tink.Aead
import com.google.crypto.tink.KeyTemplates
import com.google.crypto.tink.RegistryConfiguration
import com.google.crypto.tink.aead.AeadConfig
import com.google.crypto.tink.integration.android.AndroidKeysetManager
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable

private val Context.secureStore: DataStore<Preferences> by preferencesDataStore(name = "evtap_secure")
private val Context.settingsStore: DataStore<Preferences> by preferencesDataStore(name = "evtap_settings")

@Serializable
data class StoredTokens(val accessToken: String, val refreshToken: String, val userId: String? = null)

/**
 * Session tokens, encrypted with a Tink AEAD key that is itself wrapped by an Android Keystore master key
 * (EncryptedSharedPreferences is deprecated; this is the recommended DataStore + Tink replacement).
 * [current] is an in-memory copy for OkHttp interceptors, which must not suspend.
 */
class TokenStore(private val context: Context) {
    @Volatile var current: StoredTokens? = null
        private set

    private val aead: Aead? by lazy {
        runCatching {
            AeadConfig.register()
            AndroidKeysetManager.Builder()
                .withSharedPref(context, KEYSET_NAME, KEYSET_PREFS)
                .withKeyTemplate(KeyTemplates.get("AES256_GCM"))
                .withMasterKeyUri(MASTER_KEY_URI)
                .build()
                .keysetHandle
                .getPrimitive(RegistryConfiguration.get(), Aead::class.java)
        }.getOrNull()
    }

    suspend fun load(): StoredTokens? {
        val blob = context.secureStore.data.first()[KEY_TOKENS] ?: return null
        val tokens = runCatching {
            val aead = aead ?: error("keystore unavailable")
            val plain = aead.decrypt(Base64.decode(blob, Base64.NO_WRAP), ASSOCIATED_DATA)
            EvTapJson.decodeFromString(StoredTokens.serializer(), plain.decodeToString())
        }.getOrNull()
        if (tokens == null) clear() // key lost (backup restore / keystore reset) → start a fresh session
        current = tokens
        return tokens
    }

    suspend fun save(tokens: StoredTokens) {
        current = tokens
        val aead = aead ?: return // keystore unavailable: keep the session in memory only
        val cipher = aead.encrypt(EvTapJson.encodeToString(StoredTokens.serializer(), tokens).encodeToByteArray(), ASSOCIATED_DATA)
        context.secureStore.edit { it[KEY_TOKENS] = Base64.encodeToString(cipher, Base64.NO_WRAP) }
    }

    /** Synchronous update used by the OkHttp authenticator after a refresh; persisted asynchronously by the caller. */
    fun setCurrent(tokens: StoredTokens?) {
        current = tokens
    }

    suspend fun clear() {
        current = null
        context.secureStore.edit { it.remove(KEY_TOKENS) }
    }

    private companion object {
        val KEY_TOKENS = stringPreferencesKey("tokens")
        const val KEYSET_NAME = "evtap_tokens_keyset"
        const val KEYSET_PREFS = "evtap_tink_prefs"
        const val MASTER_KEY_URI = "android-keystore://evtap_tokens_master_key"
        val ASSOCIATED_DATA = "evtap-tokens-v1".encodeToByteArray()
    }
}

/** Non-sensitive preferences. The UI language is stored by AppCompat (per-app locale API), not here. */
class SettingsStore(private val context: Context) {
    val themeMode: Flow<ThemeMode> = context.settingsStore.data.map { p ->
        p[KEY_THEME]?.let { name -> ThemeMode.entries.firstOrNull { it.name == name } } ?: ThemeMode.SYSTEM
    }
    val pushEnabled: Flow<Boolean> = context.settingsStore.data.map { it[KEY_PUSH] ?: true }

    suspend fun setThemeMode(mode: ThemeMode) = context.settingsStore.edit { it[KEY_THEME] = mode.name }
    suspend fun setPushEnabled(enabled: Boolean) = context.settingsStore.edit { it[KEY_PUSH] = enabled }
    suspend fun registeredPushToken(): String? = context.settingsStore.data.first()[KEY_PUSH_TOKEN]
    suspend fun setRegisteredPushToken(token: String?) = context.settingsStore.edit {
        if (token == null) it.remove(KEY_PUSH_TOKEN) else it[KEY_PUSH_TOKEN] = token
    }

    private companion object {
        val KEY_THEME = stringPreferencesKey("theme")
        val KEY_PUSH = booleanPreferencesKey("push_enabled")
        val KEY_PUSH_TOKEN = stringPreferencesKey("push_token")
    }
}
