package az.evtap.app.feature.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import az.evtap.app.AppContainer
import az.evtap.app.BuildConfig
import az.evtap.app.R
import az.evtap.app.ui.common.UiText
import az.evtap.app.ui.common.appViewModel
import az.evtap.app.ui.common.asString
import az.evtap.app.ui.common.fieldErrorText
import az.evtap.app.ui.components.EvScreen
import az.evtap.app.ui.components.EvTextField
import az.evtap.app.ui.components.EvTopBar
import az.evtap.app.ui.components.NoticeBanner
import az.evtap.app.ui.components.NoticeTone
import az.evtap.app.ui.components.OtpField
import az.evtap.app.ui.components.PasswordField
import az.evtap.app.ui.components.PhoneField
import az.evtap.app.ui.components.PillButton
import az.evtap.app.ui.components.PillKind
import az.evtap.app.ui.components.PillSize
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.navigation.AuthCodeRoute
import az.evtap.app.ui.navigation.AuthEmailRoute
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.navigation.PageRoute
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.format.Format
import az.evtap.core.format.Phone
import az.evtap.core.model.AuthResponse
import az.evtap.core.model.LoginInput
import az.evtap.core.model.OtpRequestInput
import az.evtap.core.model.OtpRequestResult
import az.evtap.core.model.OtpVerifyInput
import az.evtap.core.model.RegisterInput
import az.evtap.core.validation.FieldError
import az.evtap.core.validation.Rules
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class AuthViewModel(private val c: AppContainer) : ViewModel() {
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    private val _error = MutableStateFlow<UiText?>(null)
    val error: StateFlow<UiText?> = _error.asStateFlow()

    fun clearError() {
        _error.value = null
    }

    private fun run(block: suspend () -> Unit) {
        if (_busy.value) return
        _busy.value = true
        _error.value = null
        viewModelScope.launch {
            try {
                block()
            } catch (e: Exception) {
                _error.value = UiText.error(e)
            } finally {
                _busy.value = false
            }
        }
    }

    fun requestOtp(e164: String, onSent: (OtpRequestResult) -> Unit) = run {
        onSent(c.api.call { requestOtp(OtpRequestInput(e164)) })
    }

    fun verifyOtp(e164: String, code: String, name: String, onDone: (AuthResponse) -> Unit) = run {
        val res = c.api.call { verifyOtp(OtpVerifyInput(e164, code, name.trim().takeIf { it.length >= 2 })) }
        finish(res, onDone)
    }

    fun login(login: String, password: String, onDone: (AuthResponse) -> Unit) = run {
        val l = login.trim().let { if (Phone.isValid(it)) Phone.normalize(it) else it }
        finish(c.api.call { login(LoginInput(l, password)) }, onDone)
    }

    fun register(name: String, email: String, password: String, phoneDigits: String, onDone: (AuthResponse) -> Unit) = run {
        val phone = phoneDigits.takeIf { it.isNotBlank() }?.let { Phone.fromLocalDigits(it) }
        finish(c.api.call { register(RegisterInput(name.trim(), email.trim().lowercase(), password, phone)) }, onDone)
    }

    private suspend fun finish(res: AuthResponse, onDone: (AuthResponse) -> Unit) {
        c.session.onAuthenticated(res)
        c.toaster.success(R.string.auth_welcome, res.user.name.ifBlank { Format.phone(res.user.phone.orEmpty()) })
        onDone(res)
    }
}

@Composable
private fun AgreeText() {
    val navigator = LocalNavigator.current
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.auth_agree), style = EvTheme.type.caption, color = EvTheme.colors.muted)
        androidx.compose.foundation.layout.Row {
            PillButton(stringResource(R.string.profile_terms), { navigator.open(PageRoute("terms")) }, kind = PillKind.Ghost, size = PillSize.Small)
            PillButton(stringResource(R.string.profile_privacy), { navigator.open(PageRoute("privacy")) }, kind = PillKind.Ghost, size = PillSize.Small)
        }
    }
}

@Composable
fun AuthPhoneScreen() {
    val navigator = LocalNavigator.current
    val vm = appViewModel { AuthViewModel(it) }
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    var digits by rememberSaveable { mutableStateOf("") }
    val valid = Phone.isCompleteLocal(digits) && Phone.isValid(Phone.fromLocalDigits(digits))
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    val send = {
        if (valid) {
            val e164 = Phone.fromLocalDigits(digits)
            vm.requestOtp(e164) { r -> navigator.open(AuthCodeRoute(e164, r.retryAfter, r.devCode)) }
        }
    }
    EvScreen(
        topBar = { EvTopBar(null, navigator::back) },
        bottomBar = { PillButton(stringResource(R.string.auth_send_code), send, Modifier.fillMaxWidth(), enabled = valid, loading = busy) },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(padding).padding(horizontal = 24.dp).imePadding(),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            AuthTitle(stringResource(R.string.auth_title), stringResource(R.string.auth_subtitle))
            PhoneField(
                digits,
                { digits = it; vm.clearError() },
                stringResource(R.string.auth_phone),
                error = error?.asString(),
                onIme = send,
                focusRequester = focus,
            )
            PillButton(stringResource(R.string.auth_email_login), { navigator.open(AuthEmailRoute(false)) }, Modifier.fillMaxWidth(), kind = PillKind.Secondary, icon = EvIcons.Mail)
            AgreeText()
        }
    }
}

@Composable
private fun AuthTitle(title: String, subtitle: String) {
    val c = EvTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
        Text(title, style = EvTheme.type.h1, modifier = Modifier.semantics { heading() })
        Text(subtitle, style = EvTheme.type.body, color = c.inkSecondary)
    }
}

@Composable
fun AuthCodeScreen(phone: String, retryAfter: Int, devCode: String?) {
    val navigator = LocalNavigator.current
    val vm = appViewModel(key = "otp-$phone") { AuthViewModel(it) }
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    var code by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    var hint by rememberSaveable { mutableStateOf(devCode) }
    var seconds by rememberSaveable { mutableIntStateOf(retryAfter.coerceAtLeast(0)) }
    var resendKey by rememberSaveable { mutableIntStateOf(0) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    LaunchedEffect(resendKey) {
        while (seconds > 0) {
            delay(1_000)
            seconds--
        }
    }
    val verify = { c: String -> if (c.length == 6) vm.verifyOtp(phone, c, name) { navigator.finishAuth() } }

    EvScreen(
        topBar = { EvTopBar(null, navigator::back) },
        bottomBar = { PillButton(stringResource(R.string.common_continue), { verify(code) }, Modifier.fillMaxWidth(), enabled = code.length == 6, loading = busy) },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(padding).padding(horizontal = 24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            AuthTitle(stringResource(R.string.auth_code_title), stringResource(R.string.auth_code_sent_to, Format.phone(phone)))
            OtpField(
                code,
                { code = it; vm.clearError() },
                error = error != null,
                focusRequester = focus,
                onComplete = { verify(it) },
                contentDescription = stringResource(R.string.auth_code_title),
            )
            error?.let { Text(it.asString(), style = EvTheme.type.caption, color = EvTheme.colors.danger, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive }) }
            if (BuildConfig.DEBUG && hint != null) NoticeBanner(stringResource(R.string.auth_dev_code, hint!!), tone = NoticeTone.Highlight)
            EvTextField(
                name,
                { name = it },
                stringResource(R.string.auth_name) + " (" + stringResource(R.string.common_optional) + ")",
                hint = stringResource(R.string.auth_name_hint),
                maxLength = 80,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { verify(code) }),
            )
            if (seconds > 0) {
                Text(stringResource(R.string.auth_resend_in, seconds), style = EvTheme.type.label, color = EvTheme.colors.muted, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            } else {
                PillButton(stringResource(R.string.auth_resend), {
                    vm.requestOtp(phone) { r ->
                        seconds = r.retryAfter
                        hint = r.devCode
                        resendKey++
                    }
                }, kind = PillKind.Secondary, size = PillSize.Medium, icon = EvIcons.RotateCcw)
            }
            PillButton(stringResource(R.string.auth_change_number), navigator::back, kind = PillKind.Ghost, size = PillSize.Small)
        }
    }
}

@Composable
fun AuthEmailScreen(register: Boolean) {
    val navigator = LocalNavigator.current
    val vm = appViewModel { AuthViewModel(it) }
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    var isRegister by rememberSaveable { mutableStateOf(register) }
    var login by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    var showPassword by rememberSaveable { mutableStateOf(false) }
    var submitted by rememberSaveable { mutableStateOf(false) }

    val nameErr = if (submitted && isRegister) Rules.text(name, 2, 80) else null
    val emailErr = if (submitted && isRegister) Rules.email(email) else null
    val passErr = if (submitted) (if (isRegister) Rules.password(password) else if (password.isEmpty()) FieldError.Required else null) else null
    val loginErr = if (submitted && !isRegister && login.trim().length < 3) FieldError.MinLength(3) else null
    val phoneErr = if (submitted && isRegister && phone.isNotBlank() && !Phone.isValid(Phone.fromLocalDigits(phone))) FieldError.InvalidPhone else null

    val submit = {
        submitted = true
        val ok = if (isRegister) {
            Rules.text(name, 2, 80) == null && Rules.email(email) == null && Rules.password(password) == null &&
                (phone.isBlank() || Phone.isValid(Phone.fromLocalDigits(phone)))
        } else login.trim().length >= 3 && password.isNotEmpty()
        if (ok) {
            if (isRegister) vm.register(name, email, password, phone) { navigator.finishAuth() }
            else vm.login(login, password) { navigator.finishAuth() }
        }
    }

    EvScreen(
        topBar = { EvTopBar(null, navigator::back) },
        bottomBar = {
            PillButton(stringResource(if (isRegister) R.string.auth_sign_up else R.string.auth_sign_in), submit, Modifier.fillMaxWidth(), loading = busy)
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(padding).padding(horizontal = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            AuthTitle(stringResource(if (isRegister) R.string.auth_sign_up else R.string.auth_sign_in), stringResource(R.string.auth_title))
            error?.let { NoticeBanner(it.asString(), tone = NoticeTone.Danger) }
            if (isRegister) {
                EvTextField(name, { name = it }, stringResource(R.string.auth_name), error = fieldErrorText(nameErr), maxLength = 80,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next))
                EvTextField(email, { email = it }, stringResource(R.string.auth_email), error = fieldErrorText(emailErr), leadingIcon = EvIcons.Mail,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next))
                PhoneField(phone, { phone = it }, stringResource(R.string.auth_phone) + " (" + stringResource(R.string.common_optional) + ")", error = fieldErrorText(phoneErr), imeAction = ImeAction.Next)
            } else {
                EvTextField(login, { login = it }, stringResource(R.string.auth_login), error = fieldErrorText(loginErr), leadingIcon = EvIcons.User,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next))
            }
            PasswordField(password, { password = it }, stringResource(R.string.auth_password), showPassword, { showPassword = !showPassword },
                error = fieldErrorText(passErr), onIme = { submit() })
            PillButton(
                stringResource(if (isRegister) R.string.auth_have_account else R.string.auth_no_account),
                { isRegister = !isRegister; submitted = false; vm.clearError() },
                Modifier.fillMaxWidth(),
                kind = PillKind.Ghost,
            )
            PillButton(stringResource(R.string.auth_phone_login), navigator::back, Modifier.fillMaxWidth(), kind = PillKind.Secondary, icon = EvIcons.Smartphone)
            AgreeText()
            Spacer(Modifier.height(12.dp))
        }
    }
}
