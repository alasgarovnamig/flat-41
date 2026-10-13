package az.evtap.app.feature.listing

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import az.evtap.app.AppContainer
import az.evtap.app.R
import az.evtap.app.ui.common.Load
import az.evtap.app.ui.common.loadInto
import az.evtap.core.format.Phone
import az.evtap.core.model.ListingCard
import az.evtap.core.model.ListingDetail
import az.evtap.core.model.MortgageBank
import az.evtap.core.model.MortgageLeadInput
import az.evtap.core.model.ReportInput
import az.evtap.core.model.ReportReason
import az.evtap.core.model.Review
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class ListingViewModel(private val id: String, private val c: AppContainer) : ViewModel() {
    private val _detail = MutableStateFlow<Load<ListingDetail>>(Load.Loading)
    val detail: StateFlow<Load<ListingDetail>> = _detail.asStateFlow()
    private val _similar = MutableStateFlow<List<ListingCard>>(emptyList())
    val similar: StateFlow<List<ListingCard>> = _similar.asStateFlow()
    private val _reviews = MutableStateFlow<List<Review>>(emptyList())
    val reviews: StateFlow<List<Review>> = _reviews.asStateFlow()
    private val _phone = MutableStateFlow<String?>(null)
    val phone: StateFlow<String?> = _phone.asStateFlow()
    private val _banks = MutableStateFlow<List<MortgageBank>>(emptyList())
    val banks: StateFlow<List<MortgageBank>> = _banks.asStateFlow()
    private val _refreshing = MutableStateFlow(false)
    val refreshing: StateFlow<Boolean> = _refreshing.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    init {
        load()
    }

    fun refresh() {
        _refreshing.value = true
        load().invokeOnCompletion { _refreshing.value = false }
    }

    fun load(): kotlinx.coroutines.Job =
        loadInto(_detail, showLoading = _detail.value !is Load.Ready) {
            val d = c.api.call { listing(id) }
            c.favorites.seed(d.id, d.isFavorite || d.id in c.favorites.ids.value)
            _phone.value = d.contactPhone
            viewModelScope.launch { runCatching { c.api.call { similar(id) } }.onSuccess { _similar.value = it } }
            if (d.dealType == az.evtap.core.model.DealType.RENT_DAILY) {
                viewModelScope.launch { runCatching { c.api.call { reviews(id, 1, 3) } }.onSuccess { _reviews.value = it.items } }
            }
            if (d.dealType == az.evtap.core.model.DealType.SALE && _banks.value.isEmpty()) {
                viewModelScope.launch { runCatching { c.api.call { mortgageBanks() } }.onSuccess { _banks.value = it } }
            }
            d
        }

    /** POST /listings/:id/phone (counts a phone view) — cached for call + WhatsApp. */
    fun withPhone(action: (String) -> Unit) {
        _phone.value?.let { return action(it) }
        viewModelScope.launch {
            try {
                val p = c.api.call { revealPhone(id) }.phone
                _phone.value = p
                c.toaster.info(R.string.listing_phone_revealed)
                action(p)
            } catch (e: Exception) {
                c.toaster.error(e)
            }
        }
    }

    fun toggleFavorite() {
        viewModelScope.launch { runCatching { c.favorites.toggle(id) }.onFailure { c.toaster.error(it) } }
    }

    fun report(reason: ReportReason, comment: String, onDone: () -> Unit) {
        _busy.value = true
        viewModelScope.launch {
            try {
                c.api.call { reportListing(id, ReportInput(reason, comment.trim().ifEmpty { null })) }
                c.toaster.success(R.string.report_sent)
                onDone()
            } catch (e: Exception) {
                c.toaster.error(e)
            } finally {
                _busy.value = false
            }
        }
    }

    fun mortgageLead(name: String, phoneDigits: String, price: Long, downPayment: Long, years: Int, bankCode: String?, onDone: () -> Unit) {
        _busy.value = true
        viewModelScope.launch {
            try {
                c.api.call { mortgageLead(MortgageLeadInput(name.trim(), Phone.fromLocalDigits(phoneDigits), id, price, downPayment, years, bankCode)) }
                c.toaster.success(R.string.mortgage_sent)
                onDone()
            } catch (e: Exception) {
                c.toaster.error(e)
            } finally {
                _busy.value = false
            }
        }
    }
}
