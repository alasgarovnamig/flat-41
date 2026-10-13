package az.evtap.app.feature.messages

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import az.evtap.app.AppContainer
import az.evtap.app.R
import az.evtap.app.data.SessionState
import az.evtap.app.feature.main.TabBarClearance
import az.evtap.app.ui.common.Dates
import az.evtap.app.ui.common.LocalAppContainer
import az.evtap.app.ui.common.Pager
import az.evtap.app.ui.common.UiText
import az.evtap.app.ui.common.appViewModel
import az.evtap.app.ui.common.priceParts
import az.evtap.app.ui.common.relativeTime
import az.evtap.app.ui.components.Avatar
import az.evtap.app.ui.components.CircleStyle
import az.evtap.app.ui.components.CountBubble
import az.evtap.app.ui.components.EmptyState
import az.evtap.app.ui.components.ErrorState
import az.evtap.app.ui.components.EvCard
import az.evtap.app.ui.components.EvImage
import az.evtap.app.ui.components.EvScreen
import az.evtap.app.ui.components.EvTextField
import az.evtap.app.ui.components.EvTopBar
import az.evtap.app.ui.components.IconCircleButton
import az.evtap.app.ui.components.LoadingBox
import az.evtap.app.ui.components.LoadingFooter
import az.evtap.app.ui.components.PillButton
import az.evtap.app.ui.components.PillKind
import az.evtap.app.ui.components.PillSize
import az.evtap.app.ui.components.PriceText
import az.evtap.app.ui.components.pressable
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.navigation.ChatRoute
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.navigation.MainTab
import az.evtap.app.ui.theme.EvRadius
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.model.Conversation
import az.evtap.core.model.Message
import az.evtap.core.model.SendMessageInput
import az.evtap.core.model.StartConversationInput
import az.evtap.core.realtime.RealtimeEvent
import az.evtap.core.realtime.Throttle
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID

// ───────────────────────────── Conversation list (tab) ─────────────────────────────

class MessagesViewModel(private val c: AppContainer) : ViewModel() {
    val pager = Pager<Conversation>(viewModelScope, pageSize = 30) { page, size -> c.api.call { conversations(page, size) } }
    private var loaded = false

    init {
        viewModelScope.launch {
            c.session.state.collect { s ->
                if (s is SessionState.Authed && !loaded) {
                    loaded = true
                    pager.refresh()
                }
                if (s is SessionState.Guest) loaded = false
            }
        }
        viewModelScope.launch {
            c.realtime.events.collect { e ->
                if (loaded && (e is RealtimeEvent.MessageNew || e is RealtimeEvent.ConversationRead)) pager.refresh()
            }
        }
    }
}

@Composable
fun MessagesScreen() {
    val navigator = LocalNavigator.current
    val container = LocalAppContainer.current
    val session by container.session.state.collectAsStateWithLifecycle()
    val vm = appViewModel { MessagesViewModel(it) }
    val state by vm.pager.state.collectAsStateWithLifecycle()
    val meId = (session as? SessionState.Authed)?.userId
    val list = rememberLazyListState()
    val nearEnd by remember { derivedStateOf { (list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= list.layoutInfo.totalItemsCount - 3 } }
    LaunchedEffect(nearEnd) { if (nearEnd) vm.pager.loadMore() }

    Column(Modifier.fillMaxSize()) {
        EvTopBar(stringResource(R.string.messages_title), onBack = null, large = true)
        if (session !is SessionState.Authed) {
            EmptyState(EvIcons.MessageCircle, stringResource(R.string.profile_guest_title), body = stringResource(R.string.messages_empty_hint),
                actionLabel = stringResource(R.string.common_login), onAction = navigator::login)
            return
        }
        PullToRefreshBox(state.refreshing, { vm.pager.refresh(userInitiated = true) }, Modifier.fillMaxSize()) {
            LazyColumn(
                state = list,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = TabBarClearance + 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (state.isInitialLoading) item { LoadingBox() }
                items(state.items, key = { it.id }) { conv -> ConversationRow(conv, meId) { navigator.open(ChatRoute(conv.id)) } }
                state.error?.let { item { ErrorState(it, vm.pager::retry) } }
                if (state.isEmpty) {
                    item {
                        EmptyState(EvIcons.MessageCircle, stringResource(R.string.messages_empty), body = stringResource(R.string.messages_empty_hint),
                            actionLabel = stringResource(R.string.search_title), onAction = { navigator.tab = MainTab.SEARCH })
                    }
                }
                if (state.loading && state.items.isNotEmpty()) item { LoadingFooter() }
            }
        }
    }
}

@Composable
private fun ConversationRow(conv: Conversation, meId: String?, onClick: () -> Unit) {
    val c = EvTheme.colors
    val last = conv.lastMessage
    val preview = last?.let { (if (it.senderId == meId) stringResource(R.string.messages_you) else "") + it.body }.orEmpty()
    EvCard(Modifier.fillMaxWidth(), color = c.surfaceRaised, contentPadding = PaddingValues(12.dp), onClick = onClick) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box {
                EvImage(conv.listing.coverUrl, null, Modifier.size(60.dp).clip(RoundedCornerShape(EvRadius.md)))
                Avatar(conv.otherUser.avatarUrl, conv.otherUser.name, Modifier.align(Alignment.BottomEnd).padding(0.dp), size = 26.dp)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(conv.otherUser.name, style = EvTheme.type.bodyStrong, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(relativeTime(last?.createdAt ?: conv.updatedAt), style = EvTheme.type.caption, color = c.muted)
                }
                Text(conv.listing.title, style = EvTheme.type.caption, color = c.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        preview,
                        style = if (conv.unreadCount > 0) EvTheme.type.label else EvTheme.type.caption,
                        color = if (conv.unreadCount > 0) c.ink else c.muted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (conv.unreadCount > 0) CountBubble(conv.unreadCount)
                }
            }
        }
    }
}

// ───────────────────────────── Chat thread ─────────────────────────────

/** A message plus local delivery state (optimistic send). */
data class ChatItem(val message: Message, val pending: Boolean = false, val failed: Boolean = false)

data class ChatState(
    val conversation: Conversation? = null,
    val items: List<ChatItem> = emptyList(), // oldest → newest
    val loading: Boolean = true,
    val error: UiText? = null,
    val loadingOlder: Boolean = false,
    val reachedStart: Boolean = false,
    val otherTyping: Boolean = false,
)

class ChatViewModel(private val conversationId: String, private val c: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(ChatState())
    val state: StateFlow<ChatState> = _state.asStateFlow()
    val meId: String? get() = c.session.me?.id ?: (c.session.state.value as? SessionState.Authed)?.userId
    private val typingThrottle = Throttle(1_000)
    private var typingJob: Job? = null

    init {
        load()
        viewModelScope.launch {
            c.realtime.events.collect { e ->
                when (e) {
                    is RealtimeEvent.MessageNew -> if (e.message.conversationId == conversationId) onIncoming(e.message)
                    is RealtimeEvent.ConversationRead -> if (e.conversationId == conversationId && e.readerId != meId) markMineRead(e.readAt)
                    is RealtimeEvent.Typing -> if (e.conversationId == conversationId && e.userId != meId) showTyping()
                    else -> Unit
                }
            }
        }
    }

    fun load() {
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            try {
                val conv = c.api.call { conversation(conversationId) }
                val msgs = c.api.call { messages(conversationId, null, 50) }
                _state.update { it.copy(conversation = conv, items = msgs.map { m -> ChatItem(m) }, loading = false, reachedStart = msgs.size < 50) }
                markRead()
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = UiText.error(e)) }
            }
        }
    }

    fun loadOlder() {
        val s = _state.value
        if (s.loadingOlder || s.reachedStart || s.loading) return
        val oldest = s.items.firstOrNull { !it.pending }?.message?.id ?: return
        _state.update { it.copy(loadingOlder = true) }
        viewModelScope.launch {
            try {
                val older = c.api.call { messages(conversationId, oldest, 50) }
                _state.update { st ->
                    val known = st.items.map { it.message.id }.toSet()
                    st.copy(items = older.filter { it.id !in known }.map { ChatItem(it) } + st.items, loadingOlder = false, reachedStart = older.size < 50)
                }
            } catch (e: Exception) {
                _state.update { it.copy(loadingOlder = false) }
            }
        }
    }

    private fun onIncoming(m: Message) {
        _state.update { st ->
            if (st.items.any { it.message.id == m.id }) st
            else {
                // replace a matching optimistic message of mine instead of duplicating it
                val idx = st.items.indexOfFirst { it.pending && it.message.senderId == m.senderId && it.message.body == m.body }
                val items = if (idx >= 0) st.items.toMutableList().also { it[idx] = ChatItem(m) } else st.items + ChatItem(m)
                st.copy(items = items, otherTyping = if (m.senderId != meId) false else st.otherTyping)
            }
        }
        if (m.senderId != meId) markRead()
    }

    private fun markMineRead(readAt: String) {
        _state.update { st ->
            st.copy(items = st.items.map { i ->
                val m = i.message
                if (m.senderId == meId && m.readAt == null && m.createdAt <= readAt) i.copy(message = m.copy(readAt = readAt)) else i
            })
        }
    }

    private fun markRead() {
        viewModelScope.launch {
            runCatching { c.api.call { markRead(conversationId) } }
            c.session.refreshMe()
        }
    }

    private fun showTyping() {
        typingJob?.cancel()
        _state.update { it.copy(otherTyping = true) }
        typingJob = viewModelScope.launch {
            delay(3_500)
            _state.update { it.copy(otherTyping = false) }
        }
    }

    fun onTyping() {
        if (typingThrottle.tryAcquire()) c.realtime.sendTyping(conversationId)
    }

    fun send(text: String) {
        val body = text.trim()
        if (body.isEmpty()) return
        val local = Message(id = "local-" + UUID.randomUUID(), conversationId = conversationId, senderId = meId.orEmpty(), body = body, createdAt = Instant.now().toString())
        _state.update { it.copy(items = it.items + ChatItem(local, pending = true)) }
        viewModelScope.launch {
            try {
                val sent = c.api.call { sendMessage(conversationId, SendMessageInput(body)) }
                _state.update { st ->
                    // The server also echoes message:new to all of the sender's connections (multi-device sync), and that
                    // echo may arrive before this response — dedupe by message id either way.
                    val items = if (st.items.any { it.message.id == sent.id }) st.items.filterNot { it.message.id == local.id }
                    else st.items.map { if (it.message.id == local.id) ChatItem(sent) else it }
                    st.copy(items = items)
                }
            } catch (e: Exception) {
                _state.update { st -> st.copy(items = st.items.map { if (it.message.id == local.id) it.copy(pending = false, failed = true) else it }) }
                c.toaster.error(e)
            }
        }
    }

    fun retry(item: ChatItem) {
        _state.update { st -> st.copy(items = st.items.filterNot { it.message.id == item.message.id }) }
        send(item.message.body)
    }
}

@Composable
fun ChatScreen(conversationId: String) {
    val navigator = LocalNavigator.current
    val vm = appViewModel(key = "chat-$conversationId") { ChatViewModel(conversationId, it) }
    val state by vm.state.collectAsStateWithLifecycle()
    val c = EvTheme.colors
    var draft by rememberSaveable { mutableStateOf("") }
    val list = rememberLazyListState()
    // reverseLayout: index 0 = newest at the bottom; reaching the last index = top → load older.
    val atTop by remember { derivedStateOf { (list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= list.layoutInfo.totalItemsCount - 2 } }
    LaunchedEffect(atTop) { if (atTop) vm.loadOlder() }
    val newestId = state.items.lastOrNull()?.message?.id
    LaunchedEffect(newestId) { if (newestId != null && list.firstVisibleItemIndex <= 2) list.animateScrollToItem(0) }

    Column(Modifier.fillMaxSize().background(c.canvas)) {
        val conv = state.conversation
        EvTopBar(conv?.otherUser?.name ?: "", navigator::back) {
            conv?.let { Avatar(it.otherUser.avatarUrl, it.otherUser.name, size = 40.dp) }
        }
        conv?.let { cv ->
            Row(
                Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(EvRadius.lg)).background(c.surfaceRaised)
                    .pressable({ navigator.openListing(cv.listing.id) }).padding(10.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                EvImage(cv.listing.coverUrl, null, Modifier.size(44.dp).clip(RoundedCornerShape(EvRadius.sm)))
                Column(Modifier.weight(1f)) {
                    Text(cv.listing.title, style = EvTheme.type.label, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    PriceText(priceParts(cv.listing.price, cv.listing.currency.symbol, cv.listing.pricePeriod), style = EvTheme.type.caption)
                }
                Icon(EvIcons.ArrowUpRight, null, tint = c.inkSecondary, modifier = Modifier.size(18.dp))
            }
        }
        Box(Modifier.weight(1f)) {
            when {
                state.loading -> LoadingBox()
                state.error != null && state.items.isEmpty() -> ErrorState(state.error!!, vm::load)
                state.items.isEmpty() -> EmptyState(EvIcons.MessageCircle, stringResource(R.string.chat_empty))
                else -> LazyColumn(
                    state = list,
                    reverseLayout = true,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    val reversed = state.items.asReversed()
                    items(reversed.size, key = { reversed[it].message.id }) { i ->
                        val item = reversed[i]
                        val older = reversed.getOrNull(i + 1)
                        Column {
                            val day = Dates.localDate(item.message.createdAt)
                            if (older == null || Dates.localDate(older.message.createdAt) != day) {
                                Text(
                                    Dates.date(item.message.createdAt),
                                    style = EvTheme.type.micro,
                                    color = c.muted,
                                    modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                                )
                            }
                            Bubble(item, mine = item.message.senderId == vm.meId, onRetry = { vm.retry(item) })
                        }
                    }
                    if (state.loadingOlder) item { LoadingFooter() }
                }
            }
        }
        if (state.otherTyping) {
            Text(
                (state.conversation?.otherUser?.name ?: "") + " " + stringResource(R.string.chat_typing),
                style = EvTheme.type.caption,
                color = c.muted,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 2.dp).semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        Composer(
            value = draft,
            onValueChange = { draft = it; if (it.isNotBlank()) vm.onTyping() },
            onSend = { vm.send(draft); draft = "" },
        )
    }
}

@Composable
private fun Bubble(item: ChatItem, mine: Boolean, onRetry: () -> Unit) {
    val c = EvTheme.colors
    val m = item.message
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
        Column(
            Modifier
                .widthIn(max = 300.dp)
                .clip(RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp, bottomStart = if (mine) 20.dp else 6.dp, bottomEnd = if (mine) 6.dp else 20.dp))
                .background(if (mine) c.ink else c.surfaceRaised)
                .then(if (item.failed) Modifier.pressable(onRetry) else Modifier)
                .padding(horizontal = 14.dp, vertical = 9.dp),
        ) {
            Text(m.body, style = EvTheme.type.body, color = if (mine) c.onInk else c.ink)
            Row(Modifier.align(Alignment.End), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(Dates.time(m.createdAt), style = EvTheme.type.micro, color = if (mine) c.onInk.copy(alpha = 0.6f) else c.muted)
                if (mine) {
                    when {
                        item.failed -> Icon(EvIcons.AlertCircle, stringResource(R.string.common_retry), tint = c.danger, modifier = Modifier.size(14.dp))
                        item.pending -> Icon(EvIcons.Clock, null, tint = c.onInk.copy(alpha = 0.6f), modifier = Modifier.size(14.dp))
                        m.readAt != null -> Icon(EvIcons.CheckCheck, stringResource(R.string.chat_read), tint = c.accent, modifier = Modifier.size(14.dp))
                        else -> Icon(EvIcons.Check, null, tint = c.onInk.copy(alpha = 0.6f), modifier = Modifier.size(14.dp))
                    }
                }
            }
        }
    }
}

/** Glass composer: pill input + black send circle; stays above the keyboard. */
@Composable
private fun Composer(value: String, onValueChange: (String) -> Unit, onSend: () -> Unit) {
    val c = EvTheme.colors
    val placeholder = stringResource(R.string.chat_placeholder)
    Row(
        Modifier.fillMaxWidth().background(c.canvas).navigationBarsPadding().imePadding().padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        BasicTextField(
            value = value,
            onValueChange = { onValueChange(it.take(2000)) },
            modifier = Modifier.weight(1f).semantics { contentDescription = placeholder },
            textStyle = EvTheme.type.body.copy(color = c.ink),
            cursorBrush = SolidColor(c.ink),
            maxLines = 5,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            decorationBox = { inner ->
                Box(
                    Modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(24.dp)).background(c.surfaceRaised).padding(horizontal = 18.dp, vertical = 13.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    if (value.isEmpty()) Text(placeholder, style = EvTheme.type.body, color = c.muted)
                    inner()
                }
            },
        )
        IconCircleButton(EvIcons.Send, stringResource(R.string.common_send), onSend, style = CircleStyle.Ink, size = 48.dp, enabled = value.isNotBlank())
    }
}

// ───────────────────────────── New conversation ─────────────────────────────

class NewChatViewModel(private val c: AppContainer) : ViewModel() {
    val busy = MutableStateFlow(false)
    fun start(listingId: String, text: String, onDone: (Conversation) -> Unit) {
        if (busy.value) return
        busy.value = true
        viewModelScope.launch {
            try {
                onDone(c.api.call { startConversation(StartConversationInput(listingId, text.trim())) })
            } catch (e: Exception) {
                c.toaster.error(e)
            } finally {
                busy.value = false
            }
        }
    }
}

@Composable
fun NewChatScreen(listingId: String, title: String, name: String) {
    val navigator = LocalNavigator.current
    val vm = appViewModel(key = "newchat-$listingId") { NewChatViewModel(it) }
    val busy by vm.busy.collectAsStateWithLifecycle()
    val first = stringResource(R.string.chat_first_message)
    var text by rememberSaveable { mutableStateOf(first) }
    EvScreen(
        topBar = { EvTopBar(stringResource(R.string.chat_new_title), navigator::back, large = true, subtitle = "$name · $title") },
        bottomBar = {
            PillButton(stringResource(R.string.common_send), {
                vm.start(listingId, text) { conv -> navigator.replace(ChatRoute(conv.id)) }
            }, Modifier.fillMaxWidth(), enabled = text.isNotBlank(), loading = busy, icon = EvIcons.Send)
        },
    ) { padding ->
        Column(Modifier.padding(padding).padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            EvTextField(text, { text = it }, stringResource(R.string.chat_placeholder), singleLine = false, minLines = 4, maxLength = 2000)
            androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(R.string.chat_quick_available, R.string.chat_quick_viewing, R.string.chat_quick_price).forEach { res ->
                    val q = stringResource(res)
                    PillButton(q, { text = q }, kind = PillKind.Secondary, size = PillSize.Small)
                }
            }
        }
    }
}

