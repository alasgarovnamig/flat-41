package az.evtap.app.feature.business

import android.net.Uri
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import az.evtap.app.AppContainer
import az.evtap.app.R
import az.evtap.app.data.SessionState
import az.evtap.app.platform.downscaleToJpeg
import az.evtap.app.platform.uploadImage
import az.evtap.app.ui.common.Labels
import az.evtap.app.ui.common.LocalAppContainer
import az.evtap.app.ui.common.LocalAppLocale
import az.evtap.app.ui.common.UiText
import az.evtap.app.ui.common.absUrl
import az.evtap.app.ui.common.appViewModel
import az.evtap.app.ui.common.fieldErrorText
import az.evtap.app.ui.components.Avatar
import az.evtap.app.ui.components.CircleStyle
import az.evtap.app.ui.components.ErrorState
import az.evtap.app.ui.components.EvCard
import az.evtap.app.ui.components.EvScreen
import az.evtap.app.ui.components.EvTextField
import az.evtap.app.ui.components.EvTopBar
import az.evtap.app.ui.components.IconCircleButton
import az.evtap.app.ui.components.LoadingBox
import az.evtap.app.ui.components.MetricTile
import az.evtap.app.ui.components.NoticeBanner
import az.evtap.app.ui.components.NoticeTone
import az.evtap.app.ui.components.OptionSheet
import az.evtap.app.ui.components.PhoneField
import az.evtap.app.ui.components.PillButton
import az.evtap.app.ui.components.PillKind
import az.evtap.app.ui.components.PillSize
import az.evtap.app.ui.components.Segmented
import az.evtap.app.ui.components.SelectField
import az.evtap.app.ui.components.StatCard
import az.evtap.app.ui.components.Tag
import az.evtap.app.ui.components.deltaPercent
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.api.ApiException
import az.evtap.core.format.Format
import az.evtap.core.format.Phone
import az.evtap.core.model.AddMemberInput
import az.evtap.core.model.Agency
import az.evtap.core.model.AgencyInput
import az.evtap.core.model.AgencyMember
import az.evtap.core.model.AgencyMemberRole
import az.evtap.core.model.AgencyStats
import az.evtap.core.model.AgencyType
import az.evtap.core.validation.Rules
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AgencyUi(
    val loading: Boolean = true,
    val error: UiText? = null,
    val agency: Agency? = null,
    val members: List<AgencyMember> = emptyList(),
    val stats: AgencyStats? = null,
    val saving: Boolean = false,
    val uploadingLogo: Boolean = false,
)

class AgencyViewModel(private val c: AppContainer) : ViewModel() {
    private val _ui = MutableStateFlow(AgencyUi())
    val ui: StateFlow<AgencyUi> = _ui.asStateFlow()

    init {
        load()
    }

    fun load() {
        _ui.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val agency = c.api.call { myAgency() }
                _ui.update { it.copy(agency = agency, loading = false) }
                runCatching { c.api.call { agencyMembers() } }.onSuccess { m -> _ui.update { it.copy(members = m) } }
                runCatching { c.api.call { agencyStats(30) } }.onSuccess { s -> _ui.update { it.copy(stats = s) } }
            } catch (e: ApiException) {
                // 404 / NO_AGENCY → show the create form
                if (e.isNotFound || e.code == "NO_AGENCY") _ui.update { it.copy(loading = false, agency = null) }
                else _ui.update { it.copy(loading = false, error = UiText.error(e)) }
            }
        }
    }

    fun save(input: AgencyInput) {
        _ui.update { it.copy(saving = true) }
        viewModelScope.launch {
            try {
                val exists = _ui.value.agency != null
                val a = c.api.call { if (exists) updateMyAgency(input) else createAgency(input) }
                _ui.update { it.copy(agency = a, saving = false) }
                c.toaster.success(R.string.common_saved)
                if (!exists) {
                    c.session.refreshMe() // account becomes BUSINESS
                    load()
                }
            } catch (e: Exception) {
                _ui.update { it.copy(saving = false) }
                c.toaster.error(e)
            }
        }
    }

    /** Uploads a logo and returns its absolute URL (agencySchema.logoUrl must be a URL). */
    fun uploadLogo(uri: Uri, onUrl: (String) -> Unit) {
        _ui.update { it.copy(uploadingLogo = true) }
        viewModelScope.launch {
            try {
                val file = downscaleToJpeg(c.app, uri, maxSide = 800)
                val up = c.api.uploadImage(file) {}
                file.delete()
                absUrl(c.apiOrigin, up.url)?.let(onUrl)
            } catch (e: Exception) {
                c.toaster.error(e)
            } finally {
                _ui.update { it.copy(uploadingLogo = false) }
            }
        }
    }

    fun addMember(login: String, onDone: () -> Unit) {
        viewModelScope.launch {
            try {
                val m = c.api.call { addAgencyMember(AddMemberInput(login.trim())) }
                _ui.update { it.copy(members = it.members + m) }
                onDone()
            } catch (e: Exception) {
                c.toaster.error(e)
            }
        }
    }

    fun removeMember(m: AgencyMember) {
        viewModelScope.launch {
            try {
                c.api.call { removeAgencyMember(m.userId) }
                _ui.update { it.copy(members = it.members.filterNot { x -> x.userId == m.userId }) }
            } catch (e: Exception) {
                c.toaster.error(e)
            }
        }
    }
}

@Composable
fun AgencyScreen() {
    val navigator = LocalNavigator.current
    val container = LocalAppContainer.current
    val vm = appViewModel { AgencyViewModel(it) }
    val ui by vm.ui.collectAsStateWithLifecycle()
    val session by container.session.state.collectAsStateWithLifecycle()
    val meId = (session as? SessionState.Authed)?.me?.id
    val locale = LocalAppLocale.current
    val c = EvTheme.colors

    val a = ui.agency
    var name by rememberSaveable(a?.id) { mutableStateOf(a?.name.orEmpty()) }
    var type by rememberSaveable(a?.id) { mutableStateOf(a?.type ?: AgencyType.AGENCY) }
    var description by rememberSaveable(a?.id) { mutableStateOf(a?.description.orEmpty()) }
    var phone by rememberSaveable(a?.id) { mutableStateOf(Phone.toLocalDigits(a?.phone)) }
    var email by rememberSaveable(a?.id) { mutableStateOf(a?.email.orEmpty()) }
    var website by rememberSaveable(a?.id) { mutableStateOf(a?.website.orEmpty()) }
    var address by rememberSaveable(a?.id) { mutableStateOf(a?.address.orEmpty()) }
    var cityId by rememberSaveable(a?.id) { mutableStateOf(a?.cityId) }
    var logoUrl by rememberSaveable(a?.id) { mutableStateOf(a?.logoUrl) }
    var cityPicker by remember { mutableStateOf(false) }
    var submitted by rememberSaveable { mutableStateOf(false) }
    var newMember by rememberSaveable { mutableStateOf("") }
    val logoPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> uri?.let { vm.uploadLogo(it) { url -> logoUrl = url } } }

    val nameErr = if (submitted) Rules.text(name, 2, 120) else null
    val emailErr = if (submitted) Rules.email(email, required = false) else null
    val webErr = if (submitted) Rules.url(website) else null
    val phoneErr = if (submitted && phone.isNotBlank() && !Phone.isValid(Phone.fromLocalDigits(phone))) az.evtap.core.validation.FieldError.InvalidPhone else null

    EvScreen(
        topBar = { EvTopBar(stringResource(R.string.agency_title), navigator::back, large = true) },
        bottomBar = if (ui.loading || ui.error != null) null else ({
            PillButton(stringResource(if (a == null) R.string.agency_create else R.string.common_save), {
                submitted = true
                val ok = Rules.text(name, 2, 120) == null && Rules.email(email, false) == null && Rules.url(website) == null &&
                    (phone.isBlank() || Phone.isValid(Phone.fromLocalDigits(phone)))
                if (ok) vm.save(
                    AgencyInput(
                        name = name.trim(), type = type, description = description.trim().ifEmpty { null },
                        phone = phone.takeIf { it.isNotBlank() }?.let { Phone.fromLocalDigits(it) }, email = email.trim().ifEmpty { null },
                        website = website.trim().ifEmpty { null }, address = address.trim().ifEmpty { null }, cityId = cityId, logoUrl = logoUrl,
                    ),
                )
            }, Modifier.fillMaxWidth(), loading = ui.saving)
        }),
    ) { padding ->
        when {
            ui.loading -> LoadingBox(Modifier.padding(padding))
            ui.error != null -> ErrorState(ui.error!!, vm::load, Modifier.padding(padding))
            else -> Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(padding).padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                if (a == null) {
                    NoticeBanner(stringResource(R.string.agency_create_hint), tone = NoticeTone.Highlight)
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Tag(
                            stringResource(if (a.verified) R.string.agency_verified else R.string.agency_not_verified),
                            background = if (a.verified) c.successBg else c.warningBg,
                            content = if (a.verified) c.success else c.warning,
                            icon = if (a.verified) EvIcons.BadgeCheck else EvIcons.Clock,
                        )
                        Text(stringResource(R.string.listing_active_listings, a.activeListings), style = EvTheme.type.caption, color = c.muted)
                    }
                    ui.stats?.let { s ->
                        val daily = s.daily.map { it.value.toFloat() }
                        StatCard(
                            stringResource(R.string.my_listings_views),
                            AnnotatedString(Format.groupThousands(s.views)),
                            stringResource(R.string.my_listings_stats_title),
                            Modifier.fillMaxWidth(),
                            spark = daily,
                            tag = deltaPercent(daily),
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            MetricTile(stringResource(R.string.my_listings_phone_views), Format.groupThousands(s.phoneViews), Modifier.weight(1f))
                            MetricTile(stringResource(R.string.my_listings_messages), Format.groupThousands(s.messages), Modifier.weight(1f))
                        }
                    }
                }

                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Avatar(logoUrl, name.ifBlank { "?" }, size = 64.dp)
                    PillButton(
                        stringResource(R.string.agency_logo),
                        { logoPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                        kind = PillKind.Secondary,
                        size = PillSize.Medium,
                        icon = EvIcons.ImagePlus,
                        loading = ui.uploadingLogo,
                    )
                }
                EvTextField(name, { name = it }, stringResource(R.string.agency_name), error = fieldErrorText(nameErr), maxLength = 120)
                Text(stringResource(R.string.agency_type), style = EvTheme.type.label, color = c.inkSecondary)
                Segmented(AgencyType.entries.map { it to stringResource(Labels.agencyType(it)) }, type, { type = it })
                EvTextField(description, { description = it }, stringResource(R.string.agency_description), singleLine = false, minLines = 3, maxLength = 5000)
                PhoneField(phone, { phone = it }, stringResource(R.string.agency_phone), error = fieldErrorText(phoneErr))
                EvTextField(email, { email = it }, stringResource(R.string.agency_email), error = fieldErrorText(emailErr), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
                EvTextField(website, { website = it }, stringResource(R.string.agency_website), placeholder = "https://", error = fieldErrorText(webErr), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
                SelectField(stringResource(R.string.agency_city), container.locations.city(cityId)?.name?.get(locale), stringResource(R.string.common_select), { cityPicker = true })
                EvTextField(address, { address = it }, stringResource(R.string.agency_address), maxLength = 200)

                if (a != null && a.ownerId == meId) {
                    EvCard(Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.agency_members), style = EvTheme.type.h3)
                        ui.members.forEach { m ->
                            Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Avatar(m.avatarUrl, m.name, size = 40.dp)
                                Column(Modifier.weight(1f)) {
                                    Text(m.name, style = EvTheme.type.bodyStrong)
                                    Text(listOfNotNull(m.phone?.let { Format.phone(it) }, m.email).joinToString(" · "), style = EvTheme.type.caption, color = c.muted)
                                }
                                if (m.role != AgencyMemberRole.OWNER) {
                                    IconCircleButton(EvIcons.Trash, stringResource(R.string.common_delete), { vm.removeMember(m) }, style = CircleStyle.Raised, size = 40.dp)
                                }
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                        EvTextField(newMember, { newMember = it }, stringResource(R.string.agency_add_member), placeholder = stringResource(R.string.auth_login))
                        Spacer(Modifier.height(8.dp))
                        PillButton(stringResource(R.string.agency_add_member), { vm.addMember(newMember) { newMember = "" } }, Modifier.fillMaxWidth(), kind = PillKind.Secondary,
                            icon = EvIcons.Plus, enabled = newMember.trim().length >= 3)
                    }
                }
                Spacer(Modifier.height(8.dp))
            }
        }
    }
    if (cityPicker) {
        OptionSheet(stringResource(R.string.agency_city), container.locations.cities.map { it.id to it.name.get(locale) }, setOfNotNull(cityId), false, { cityPicker = false }, { cityId = it.firstOrNull() })
    }
}
