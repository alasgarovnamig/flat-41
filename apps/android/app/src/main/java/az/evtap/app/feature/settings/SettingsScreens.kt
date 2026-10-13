package az.evtap.app.feature.settings

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import az.evtap.app.AppContainer
import az.evtap.app.BuildConfig
import az.evtap.app.R
import az.evtap.app.data.SessionState
import az.evtap.app.feature.profile.MenuRow
import az.evtap.app.feature.profile.Section
import az.evtap.app.platform.AppLanguage
import az.evtap.app.platform.Intents
import az.evtap.app.platform.downscaleToJpeg
import az.evtap.app.platform.uploadImage
import az.evtap.app.ui.common.LocalAppContainer
import az.evtap.app.ui.common.absUrl
import az.evtap.app.ui.common.appViewModel
import az.evtap.app.ui.common.fieldErrorText
import az.evtap.app.ui.components.Avatar
import az.evtap.app.ui.components.ConfirmDialog
import az.evtap.app.ui.components.EvBottomSheet
import az.evtap.app.ui.components.EvCard
import az.evtap.app.ui.components.EvScreen
import az.evtap.app.ui.components.EvTextField
import az.evtap.app.ui.components.EvTopBar
import az.evtap.app.ui.components.NoticeBanner
import az.evtap.app.ui.components.NoticeTone
import az.evtap.app.ui.components.PasswordField
import az.evtap.app.ui.components.PillButton
import az.evtap.app.ui.components.PillKind
import az.evtap.app.ui.components.PillSize
import az.evtap.app.ui.components.RadioRow
import az.evtap.app.ui.components.Segmented
import az.evtap.app.ui.components.SwitchRow
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.navigation.EditProfileRoute
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.navigation.MainTab
import az.evtap.app.ui.navigation.PageRoute
import az.evtap.app.ui.theme.EvTheme
import az.evtap.app.ui.theme.ThemeMode
import az.evtap.core.format.Format
import az.evtap.core.model.AppLocale
import az.evtap.core.model.ChangePasswordInput
import az.evtap.core.model.UpdateMeInput
import az.evtap.core.validation.Rules
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

class SettingsViewModel(private val c: AppContainer) : ViewModel() {
    val busy = MutableStateFlow(false)

    fun setTheme(m: ThemeMode) = viewModelScope.launch { c.settings.setThemeMode(m) }

    fun setLanguage(l: AppLocale) {
        // tell the server too (push / e-mail language), then switch the UI (recreates the activity)
        if (c.session.isAuthed) c.appScope.launch { runCatching { c.api.call { updateMe(UpdateMeInput(locale = l)) } } }
        AppLanguage.set(l)
    }

    fun setPush(enabled: Boolean) = viewModelScope.launch {
        c.settings.setPushEnabled(enabled)
        if (enabled) c.push.registerIfEnabled() else c.push.unregister()
    }

    fun logout() = c.appScope.launch { c.session.logout() }

    fun deleteAccount(onDone: () -> Unit) {
        busy.value = true
        viewModelScope.launch {
            try {
                c.push.unregister()
                c.api.call { deleteMe() }
                c.session.clearLocal()
                c.toaster.success(R.string.settings_deleted)
                onDone()
            } catch (e: Exception) {
                c.toaster.error(e)
            } finally {
                busy.value = false
            }
        }
    }
}

@Composable
fun SettingsScreen() {
    val navigator = LocalNavigator.current
    val container = LocalAppContainer.current
    val context = LocalContext.current
    val vm = appViewModel { SettingsViewModel(it) }
    val theme by container.settings.themeMode.collectAsStateWithLifecycle(ThemeMode.SYSTEM)
    val push by container.settings.pushEnabled.collectAsStateWithLifecycle(true)
    val session by container.session.state.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val authed = session is SessionState.Authed
    var logoutOpen by remember { mutableStateOf(false) }
    var deleteStep by remember { mutableStateOf(0) }
    var licensesOpen by remember { mutableStateOf(false) }
    val current = AppLanguage.current()
    val notifPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> vm.setPush(granted) }

    EvScreen(topBar = { EvTopBar(stringResource(R.string.settings_title), navigator::back, large = true) }) { padding ->
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(padding).padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Section(stringResource(R.string.settings_language)) {
                listOf(AppLocale.AZ to "Azərbaycanca", AppLocale.RU to "Русский", AppLocale.EN to "English").forEach { (l, label) ->
                    RadioRow(label, current == l, { if (current != l) vm.setLanguage(l) }, Modifier.padding(horizontal = 8.dp))
                }
            }
            Section(stringResource(R.string.settings_theme)) {
                Segmented(
                    listOf(ThemeMode.SYSTEM to stringResource(R.string.settings_theme_system), ThemeMode.LIGHT to stringResource(R.string.settings_theme_light), ThemeMode.DARK to stringResource(R.string.settings_theme_dark)),
                    theme,
                    { vm.setTheme(it) },
                    Modifier.padding(8.dp),
                )
            }
            if (authed) {
                Section(stringResource(R.string.settings_push)) {
                    SwitchRow(
                        stringResource(R.string.settings_push),
                        push && container.push.isAvailable,
                        { on ->
                            if (on && Build.VERSION.SDK_INT >= 33 && !container.push.hasPermission()) notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                            else vm.setPush(on)
                        },
                        Modifier.padding(horizontal = 8.dp),
                        hint = stringResource(R.string.settings_push_hint),
                        enabled = container.push.isAvailable,
                    )
                    if (!container.push.isAvailable) {
                        Text(stringResource(R.string.settings_push_unavailable), style = EvTheme.type.caption, color = EvTheme.colors.muted, modifier = Modifier.padding(8.dp))
                    } else if (push && !container.push.hasPermission()) {
                        PillButton(stringResource(R.string.settings_push_denied), { Intents.appSettings(context) }, kind = PillKind.Ghost, size = PillSize.Small)
                    }
                }
                Section(stringResource(R.string.settings_account)) {
                    MenuRow(EvIcons.User, stringResource(R.string.settings_edit_profile)) { navigator.open(EditProfileRoute) }
                    MenuRow(EvIcons.LogOut, stringResource(R.string.common_logout)) { logoutOpen = true }
                    MenuRow(EvIcons.Trash, stringResource(R.string.settings_delete_account)) { deleteStep = 1 }
                }
            }
            Section(stringResource(R.string.settings_legal)) {
                MenuRow(EvIcons.ScrollText, stringResource(R.string.profile_terms)) { navigator.open(PageRoute("terms")) }
                MenuRow(EvIcons.Shield, stringResource(R.string.profile_privacy)) { navigator.open(PageRoute("privacy")) }
                MenuRow(EvIcons.FileText, stringResource(R.string.settings_licenses)) { licensesOpen = true }
            }
            Text(stringResource(R.string.profile_version, BuildConfig.VERSION_NAME), style = EvTheme.type.caption, color = EvTheme.colors.muted, modifier = Modifier.align(Alignment.CenterHorizontally))
            Spacer(Modifier.height(16.dp))
        }
    }

    if (logoutOpen) {
        ConfirmDialog(stringResource(R.string.common_logout), stringResource(R.string.settings_logout_confirm), stringResource(R.string.common_logout),
            onConfirm = { vm.logout(); navigator.toMain(MainTab.HOME) }, onDismiss = { logoutOpen = false }, destructive = true)
    }
    if (deleteStep == 1) {
        ConfirmDialog(stringResource(R.string.settings_delete_title), stringResource(R.string.settings_delete_text), stringResource(R.string.common_continue),
            onConfirm = { deleteStep = 2 }, onDismiss = { if (deleteStep == 1) deleteStep = 0 }, destructive = true)
    }
    if (deleteStep == 2) {
        ConfirmDialog(stringResource(R.string.settings_delete_title), stringResource(R.string.settings_delete_final), stringResource(R.string.settings_delete_account),
            onConfirm = { vm.deleteAccount { navigator.toMain(MainTab.HOME) } }, onDismiss = { deleteStep = 0 }, destructive = true)
    }
    if (licensesOpen) LicensesSheet { licensesOpen = false }
}

/** Open-source notices for bundled assets (fonts OFL, Lucide icons ISC). */
@Composable
private fun LicensesSheet(onDismiss: () -> Unit) {
    val context = LocalContext.current
    val texts = remember {
        listOf("Outfit-OFL.txt", "Inter-OFL.txt", "Lucide-ISC.txt").map { name ->
            name to runCatching { context.assets.open("licenses/$name").bufferedReader().use { it.readText() } }.getOrDefault("")
        }
    }
    EvBottomSheet(onDismiss = onDismiss, title = stringResource(R.string.settings_licenses)) {
        texts.forEach { (name, text) ->
            Text(name.substringBefore('-'), style = EvTheme.type.bodyStrong)
            Text(text, style = EvTheme.type.caption, color = EvTheme.colors.inkSecondary)
        }
    }
}

// ───────────────────────────── Edit profile ─────────────────────────────

class EditProfileViewModel(private val c: AppContainer) : ViewModel() {
    val saving = MutableStateFlow(false)
    val uploading = MutableStateFlow(false)

    fun save(name: String, email: String, onDone: () -> Unit) {
        saving.value = true
        viewModelScope.launch {
            try {
                c.api.call { updateMe(UpdateMeInput(name = name.trim(), email = email.trim().lowercase().ifEmpty { null })) }
                c.session.refreshMe()
                c.toaster.success(R.string.common_saved)
                onDone()
            } catch (e: Exception) {
                c.toaster.error(e)
            } finally {
                saving.value = false
            }
        }
    }

    fun changeAvatar(uri: android.net.Uri) {
        uploading.value = true
        viewModelScope.launch {
            try {
                val file = downscaleToJpeg(c.app, uri, maxSide = 800)
                val up = c.api.uploadImage(file) {}
                file.delete()
                val url = absUrl(c.apiOrigin, up.url)
                c.api.call { updateMe(UpdateMeInput(avatarUrl = url)) }
                c.session.refreshMe()
            } catch (e: Exception) {
                c.toaster.error(e)
            } finally {
                uploading.value = false
            }
        }
    }

    fun changePassword(current: String, new: String, onDone: () -> Unit) {
        saving.value = true
        viewModelScope.launch {
            try {
                c.api.call { changePassword(ChangePasswordInput(current.ifEmpty { null }, new)) }
                c.toaster.success(R.string.common_saved)
                onDone()
            } catch (e: Exception) {
                c.toaster.error(e)
            } finally {
                saving.value = false
            }
        }
    }
}

@Composable
fun EditProfileScreen() {
    val navigator = LocalNavigator.current
    val container = LocalAppContainer.current
    val vm = appViewModel { EditProfileViewModel(it) }
    val session by container.session.state.collectAsStateWithLifecycle()
    val me = (session as? SessionState.Authed)?.me
    val saving by vm.saving.collectAsStateWithLifecycle()
    val uploading by vm.uploading.collectAsStateWithLifecycle()
    var name by rememberSaveable(me?.id) { mutableStateOf(me?.name.orEmpty()) }
    var email by rememberSaveable(me?.id) { mutableStateOf(me?.email.orEmpty()) }
    var currentPw by rememberSaveable { mutableStateOf("") }
    var newPw by rememberSaveable { mutableStateOf("") }
    var showPw by rememberSaveable { mutableStateOf(false) }
    var submitted by rememberSaveable { mutableStateOf(false) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> uri?.let(vm::changeAvatar) }
    val nameErr = if (submitted) Rules.text(name, 2, 80) else null
    val emailErr = if (submitted) Rules.email(email, required = false) else null

    EvScreen(
        topBar = { EvTopBar(stringResource(R.string.settings_edit_profile), navigator::back, large = true) },
        bottomBar = {
            PillButton(stringResource(R.string.common_save), {
                submitted = true
                if (Rules.text(name, 2, 80) == null && Rules.email(email, false) == null) vm.save(name, email) { navigator.back() }
            }, Modifier.fillMaxWidth(), loading = saving)
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(padding).padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Avatar(me?.avatarUrl, me?.name.orEmpty(), size = 72.dp)
                PillButton(stringResource(R.string.settings_change_avatar), { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    kind = PillKind.Secondary, size = PillSize.Medium, icon = EvIcons.Camera, loading = uploading)
            }
            EvTextField(name, { name = it }, stringResource(R.string.settings_name), error = fieldErrorText(nameErr), maxLength = 80)
            EvTextField(email, { email = it }, stringResource(R.string.settings_email), error = fieldErrorText(emailErr), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
            me?.phone?.let { EvTextField(Format.phone(it), {}, stringResource(R.string.auth_phone), enabled = false) }
            EvCard(Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.settings_change_password), style = EvTheme.type.h3)
                Spacer(Modifier.height(10.dp))
                PasswordField(currentPw, { currentPw = it }, stringResource(R.string.settings_current_password), showPw, { showPw = !showPw })
                Spacer(Modifier.height(10.dp))
                PasswordField(newPw, { newPw = it }, stringResource(R.string.settings_new_password), showPw, { showPw = !showPw },
                    error = if (newPw.isNotEmpty()) fieldErrorText(Rules.password(newPw)) else null)
                Spacer(Modifier.height(10.dp))
                PillButton(stringResource(R.string.settings_change_password), { vm.changePassword(currentPw, newPw) { currentPw = ""; newPw = "" } },
                    Modifier.fillMaxWidth(), kind = PillKind.Secondary, enabled = Rules.password(newPw) == null, loading = saving)
            }
            NoticeBanner(stringResource(R.string.settings_avatar_hint), tone = NoticeTone.Info)
            Spacer(Modifier.height(8.dp))
        }
    }
}
