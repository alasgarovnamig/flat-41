package az.evtap.app

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import az.evtap.app.platform.PushManager
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade

class EvTapApp : Application(), SingletonImageLoader.Factory {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        container.session.start()
        PushManager.ensureChannel(this)

        // Realtime socket only while the app is visible (saves battery; pushes cover the background).
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                if (container.session.isAuthed) container.realtime.connect()
            }

            override fun onStop(owner: LifecycleOwner) {
                container.realtime.disconnect()
            }
        })
    }

    /** Coil shares the app's OkHttp stack (cache, TLS, debug logging). */
    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components { add(OkHttpNetworkFetcherFactory(callFactory = { container.imageHttpClient })) }
            .crossfade(!container.reducedMotion)
            .build()
}
