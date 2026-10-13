package az.evtap.app.feature.booking

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import az.evtap.app.AppContainer
import az.evtap.app.R
import az.evtap.app.ui.common.Load
import az.evtap.app.ui.common.appViewModel
import az.evtap.app.ui.common.loadInto
import az.evtap.app.ui.components.CalendarLegend
import az.evtap.app.ui.components.EmptyState
import az.evtap.app.ui.components.ErrorState
import az.evtap.app.ui.components.EvCard
import az.evtap.app.ui.components.EvScreen
import az.evtap.app.ui.components.EvTopBar
import az.evtap.app.ui.components.LoadingBox
import az.evtap.app.ui.components.MonthView
import az.evtap.app.ui.components.PillButton
import az.evtap.app.ui.components.PropertyRow
import az.evtap.app.ui.components.WeekdayHeader
import az.evtap.app.ui.components.monthsFrom
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.navigation.PostRoute
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.booking.HostCalendar
import az.evtap.core.booking.NightAvailability
import az.evtap.core.model.AvailabilityInput
import az.evtap.core.model.DealType
import az.evtap.core.model.ListingStatus
import az.evtap.core.model.MyListing
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.LocalDate

data class HostCalendarState(
    val booked: Set<LocalDate> = emptySet(),
    val blocked: Set<LocalDate> = emptySet(),
    val original: Set<LocalDate> = emptySet(),
    val loading: Boolean = true,
    val saving: Boolean = false,
) {
    val dirty: Boolean get() = blocked != original
}

class HostCalendarViewModel(initialId: String?, private val c: AppContainer) : ViewModel() {
    val listings = MutableStateFlow<Load<List<MyListing>>>(Load.Loading)
    private val _selected = MutableStateFlow(initialId)
    val selected: StateFlow<String?> = _selected.asStateFlow()
    private val _cal = MutableStateFlow(HostCalendarState())
    val cal: StateFlow<HostCalendarState> = _cal.asStateFlow()
    val today: LocalDate = LocalDate.now()

    init {
        loadInto(listings) {
            val all = mutableListOf<MyListing>()
            for (status in listOf(ListingStatus.ACTIVE, ListingStatus.PENDING)) {
                all += c.api.call { myListings(status, 1, 100) }.items.filter { it.dealType == DealType.RENT_DAILY }
            }
            if (_selected.value == null) all.firstOrNull()?.let { select(it.id) }
            all
        }
        initialId?.let { select(it) }
    }

    fun select(id: String) {
        _selected.value = id
        _cal.value = HostCalendarState(loading = true)
        viewModelScope.launch {
            try {
                val a = c.api.call { availability(id, today.toString(), today.plusMonths(12).toString()) }
                val n = NightAvailability(a)
                _cal.value = HostCalendarState(booked = n.booked, blocked = n.blocked, original = n.blocked, loading = false)
            } catch (e: Exception) {
                c.toaster.error(e)
                _cal.update { it.copy(loading = false) }
            }
        }
    }

    fun toggle(day: LocalDate) = _cal.update { it.copy(blocked = HostCalendar.toggle(it.blocked, day, today, it.booked)) }

    fun save() {
        val id = _selected.value ?: return
        _cal.update { it.copy(saving = true) }
        viewModelScope.launch {
            try {
                val dates = _cal.value.blocked.filter { !it.isBefore(today) }.sorted().map { it.toString() }
                val a = c.api.call { setAvailability(id, AvailabilityInput(dates)) }
                val n = NightAvailability(a)
                _cal.value = HostCalendarState(booked = n.booked, blocked = n.blocked, original = n.blocked, loading = false)
                c.toaster.success(R.string.common_saved)
            } catch (e: Exception) {
                c.toaster.error(e)
                _cal.update { it.copy(saving = false) }
            }
        }
    }
}

@Composable
fun HostCalendarScreen(listingId: String?) {
    val navigator = LocalNavigator.current
    val vm = appViewModel(key = "host-cal-$listingId") { HostCalendarViewModel(listingId, it) }
    val listings by vm.listings.collectAsStateWithLifecycle()
    val selected by vm.selected.collectAsStateWithLifecycle()
    val cal by vm.cal.collectAsStateWithLifecycle()
    val c = EvTheme.colors

    EvScreen(
        topBar = { EvTopBar(stringResource(R.string.calendar_title), navigator::back, large = true, subtitle = stringResource(R.string.calendar_hint)) },
        bottomBar = if (selected != null) ({
            PillButton(stringResource(R.string.common_save), vm::save, Modifier.fillMaxWidth(), enabled = cal.dirty, loading = cal.saving)
        }) else null,
    ) { padding ->
        when (val l = listings) {
            Load.Loading -> LoadingBox(Modifier.padding(padding))
            is Load.Failed -> ErrorState(l.error, null, Modifier.padding(padding))
            is Load.Ready -> if (l.data.isEmpty() && listingId == null) {
                EmptyState(
                    EvIcons.CalendarDays,
                    stringResource(R.string.calendar_no_daily),
                    Modifier.padding(padding),
                    actionLabel = stringResource(R.string.my_listings_new_listing),
                    onAction = { navigator.open(PostRoute()) },
                )
            } else {
                Column(
                    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(padding).padding(horizontal = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    if (l.data.size > 1) {
                        Text(stringResource(R.string.calendar_choose_listing), style = EvTheme.type.bodyStrong)
                        l.data.forEach { item ->
                            PropertyRow(item, onClick = { vm.select(item.id) }, thumb = 56.dp, trailing = {
                                if (item.id == selected) androidx.compose.material3.Icon(EvIcons.CheckCircle, null, tint = c.ink)
                            })
                        }
                    }
                    EvCard(Modifier.fillMaxWidth(), contentPadding = PaddingValues(16.dp)) {
                        CalendarLegend(listOf(c.successBg to stringResource(R.string.calendar_free), c.dangerBg to stringResource(R.string.calendar_blocked), c.infoBg to stringResource(R.string.calendar_booked)))
                        Spacer(Modifier.height(8.dp))
                        if (cal.loading) LoadingBox() else {
                            WeekdayHeader()
                            monthsFrom(vm.today, 12).forEach { m ->
                                MonthView(m, { HostCalendar.stateOf(it, vm.today, cal.blocked, cal.booked) }, vm::toggle)
                            }
                        }
                    }
                }
            }
        }
    }
}
