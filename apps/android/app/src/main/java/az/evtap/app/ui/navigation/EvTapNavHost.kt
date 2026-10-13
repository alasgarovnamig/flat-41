package az.evtap.app.ui.navigation

import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.toRoute
import az.evtap.app.feature.auth.AuthCodeScreen
import az.evtap.app.feature.auth.AuthEmailScreen
import az.evtap.app.feature.auth.AuthPhoneScreen
import az.evtap.app.feature.booking.BookScreen
import az.evtap.app.feature.booking.BookingScreen
import az.evtap.app.feature.booking.BookingsScreen
import az.evtap.app.feature.booking.HostCalendarScreen
import az.evtap.app.feature.business.AgencyScreen
import az.evtap.app.feature.business.BusinessScreen
import az.evtap.app.feature.favorites.FavoritesScreen
import az.evtap.app.feature.listing.GalleryScreen
import az.evtap.app.feature.listing.ListingScreen
import az.evtap.app.feature.listing.ReviewsScreen
import az.evtap.app.feature.main.MainScreen
import az.evtap.app.feature.messages.ChatScreen
import az.evtap.app.feature.messages.NewChatScreen
import az.evtap.app.feature.mylistings.ListingStatsScreen
import az.evtap.app.feature.mylistings.MyListingsScreen
import az.evtap.app.feature.notifications.NotificationsScreen
import az.evtap.app.feature.pages.PageScreen
import az.evtap.app.feature.pages.PagesScreen
import az.evtap.app.feature.payment.PaymentResultScreen
import az.evtap.app.feature.payment.PaymentsScreen
import az.evtap.app.feature.payment.WalletScreen
import az.evtap.app.feature.post.ListingFeeScreen
import az.evtap.app.feature.post.PostScreen
import az.evtap.app.feature.promote.PromoteScreen
import az.evtap.app.feature.saved.SavedSearchesScreen
import az.evtap.app.feature.settings.EditProfileScreen
import az.evtap.app.feature.settings.SettingsScreen
import az.evtap.app.ui.theme.EvTheme

@Composable
fun EvTapNavHost(navigator: AppNavigator) {
    val motion = EvTheme.motion
    val enter: EnterTransition = if (motion.reduced) EnterTransition.None else slideInHorizontally(motion.standard()) { it / 6 } + fadeIn(motion.standard())
    val exit: ExitTransition = if (motion.reduced) ExitTransition.None else fadeOut(motion.fast())
    val popEnter: EnterTransition = if (motion.reduced) EnterTransition.None else fadeIn(motion.fast())
    val popExit: ExitTransition = if (motion.reduced) ExitTransition.None else slideOutHorizontally(motion.standard()) { it / 6 } + fadeOut(motion.standard())

    NavHost(
        navController = navigator.nav,
        startDestination = MainRoute,
        enterTransition = { enter },
        exitTransition = { exit },
        popEnterTransition = { popEnter },
        popExitTransition = { popExit },
    ) {
        composable<MainRoute> { MainScreen() }
        composable<ListingRoute> { ListingScreen(it.toRoute<ListingRoute>().id) }
        composable<GalleryRoute> { val r = it.toRoute<GalleryRoute>(); GalleryScreen(r.id, r.index) }
        composable<ReviewsRoute> { ReviewsScreen(it.toRoute<ReviewsRoute>().listingId) }
        composable<BookRoute> { BookScreen(it.toRoute<BookRoute>().listingId) }
        composable<BookingRoute> { BookingScreen(it.toRoute<BookingRoute>().id) }
        composable<AuthPhoneRoute> { AuthPhoneScreen() }
        composable<AuthCodeRoute> { val r = it.toRoute<AuthCodeRoute>(); AuthCodeScreen(r.phone, r.retryAfter, r.devCode) }
        composable<AuthEmailRoute> { AuthEmailScreen(it.toRoute<AuthEmailRoute>().register) }
        composable<PostRoute> { PostScreen(it.toRoute<PostRoute>().editId) }
        composable<ListingFeeRoute> { ListingFeeScreen(it.toRoute<ListingFeeRoute>().id) }
        composable<PromoteRoute> { val r = it.toRoute<PromoteRoute>(); PromoteScreen(r.id, r.upsell) }
        composable<PaymentResultRoute> { val r = it.toRoute<PaymentResultRoute>(); PaymentResultScreen(r.paymentId, r.status) }
        composable<WalletRoute> { WalletScreen() }
        composable<PaymentsRoute> { PaymentsScreen() }
        composable<MyListingsRoute> { MyListingsScreen() }
        composable<ListingStatsRoute> { ListingStatsScreen(it.toRoute<ListingStatsRoute>().id) }
        composable<BookingsRoute> { BookingsScreen() }
        composable<HostCalendarRoute> { HostCalendarScreen(it.toRoute<HostCalendarRoute>().listingId) }
        composable<ChatRoute> { ChatScreen(it.toRoute<ChatRoute>().conversationId) }
        composable<NewChatRoute> { val r = it.toRoute<NewChatRoute>(); NewChatScreen(r.listingId, r.title, r.name) }
        composable<NotificationsRoute> { NotificationsScreen() }
        composable<SavedSearchesRoute> { SavedSearchesScreen() }
        composable<FavoritesRoute> { FavoritesScreen() }
        composable<BusinessRoute> { BusinessScreen() }
        composable<AgencyRoute> { AgencyScreen() }
        composable<SettingsRoute> { SettingsScreen() }
        composable<EditProfileRoute> { EditProfileScreen() }
        composable<PagesRoute> { PagesScreen() }
        composable<PageRoute> { PageScreen(it.toRoute<PageRoute>().slug) }
    }
}
