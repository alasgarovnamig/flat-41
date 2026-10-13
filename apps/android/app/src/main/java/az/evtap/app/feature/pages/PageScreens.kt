package az.evtap.app.feature.pages

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import az.evtap.app.AppContainer
import az.evtap.app.R
import az.evtap.app.platform.AppLanguage
import az.evtap.app.ui.common.Dates
import az.evtap.app.ui.common.LocalAppLocale
import az.evtap.app.ui.common.Load
import az.evtap.app.ui.common.appViewModel
import az.evtap.app.ui.common.loadInto
import az.evtap.app.ui.components.EmptyState
import az.evtap.app.ui.components.ErrorState
import az.evtap.app.ui.components.EvCard
import az.evtap.app.ui.components.EvScreen
import az.evtap.app.ui.components.EvTopBar
import az.evtap.app.ui.components.LoadingBox
import az.evtap.app.ui.components.MarkdownText
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.navigation.PageRoute
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.model.CmsPage
import az.evtap.core.model.PageSummary
import kotlinx.coroutines.flow.MutableStateFlow

class PagesViewModel(private val c: AppContainer) : ViewModel() {
    val pages = MutableStateFlow<Load<List<PageSummary>>>(Load.Loading)
    init {
        load()
    }
    fun load() = loadInto(pages) { c.api.call { pages(AppLanguage.current().tag) } }
}

/** GET /pages — CMS pages (about, terms, privacy, help…) with titles in the UI language. */
@Composable
fun PagesScreen() {
    val navigator = LocalNavigator.current
    val vm = appViewModel { PagesViewModel(it) }
    val load by vm.pages.collectAsStateWithLifecycle()
    EvScreen(topBar = { EvTopBar(stringResource(R.string.pages_all), navigator::back, large = true) }) { padding ->
        when (val l = load) {
            Load.Loading -> LoadingBox(Modifier.padding(padding))
            is Load.Failed -> ErrorState(l.error, vm::load, Modifier.padding(padding))
            is Load.Ready -> LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = padding.calculateTopPadding(), bottom = padding.calculateBottomPadding() + 24.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (l.data.isEmpty()) item { EmptyState(EvIcons.FileText, stringResource(R.string.common_empty_title)) }
                items(l.data, key = { it.slug }) { p ->
                    EvCard(Modifier.fillMaxWidth(), color = EvTheme.colors.surfaceRaised, onClick = { navigator.open(PageRoute(p.slug)) }) {
                        Text(p.title.ifBlank { p.slug }, style = EvTheme.type.bodyStrong)
                    }
                }
            }
        }
    }
}

class PageViewModel(slug: String, c: AppContainer) : ViewModel() {
    val page = MutableStateFlow<Load<CmsPage>>(Load.Loading)
    init {
        loadInto(page) { c.api.call { page(slug) } }
    }
}

@Composable
fun PageScreen(slug: String) {
    val navigator = LocalNavigator.current
    val vm = appViewModel(key = "page-$slug") { PageViewModel(slug, it) }
    val load by vm.page.collectAsStateWithLifecycle()
    val locale = LocalAppLocale.current
    val page = load.dataOrNull
    EvScreen(topBar = { EvTopBar(page?.title?.get(locale) ?: "", navigator::back, large = page != null) }) { padding ->
        when (val l = load) {
            Load.Loading -> LoadingBox(Modifier.padding(padding))
            is Load.Failed -> if (l.error.let { it is az.evtap.app.ui.common.UiText.Error && it.message == az.evtap.core.api.UserMessage.NotFound }) {
                EmptyState(EvIcons.FileText, stringResource(R.string.page_not_found), Modifier.padding(padding))
            } else ErrorState(l.error, null, Modifier.padding(padding))
            is Load.Ready -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(padding).padding(horizontal = 20.dp, vertical = 8.dp)) {
                MarkdownText(l.data.body.get(locale))
                if (l.data.updatedAt.isNotBlank()) {
                    Text(stringResource(R.string.listing_updated, Dates.date(l.data.updatedAt)), style = EvTheme.type.caption, color = EvTheme.colors.muted, modifier = Modifier.padding(top = 20.dp, bottom = 24.dp))
                }
            }
        }
    }
}
