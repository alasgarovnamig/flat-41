package az.evtap.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import az.evtap.app.BuildConfig
import az.evtap.app.R
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.format.Format
import az.evtap.core.search.BBox
import az.evtap.core.search.MapMarker
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.GoogleMapOptions
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.MapStyleOptions
import com.google.maps.android.compose.CameraPositionState
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.MarkerComposable
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.rememberCameraPositionState
import com.google.maps.android.compose.rememberUpdatedMarkerState
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope

/** Grayscale JSON map style matching the light / dark token set (MapCard: "tiles desaturated"). */
@Composable
private fun rememberMapProperties(myLocation: Boolean = false): MapProperties {
    val context = LocalContext.current
    val dark = EvTheme.isDark
    return remember(dark, myLocation) {
        MapProperties(
            mapStyleOptions = runCatching { MapStyleOptions.loadRawResourceStyle(context, if (dark) R.raw.map_style_dark else R.raw.map_style_light) }.getOrNull(),
            isMyLocationEnabled = myLocation,
            minZoomPreference = 4f,
        )
    }
}

/** Shown instead of the map when the build has no MAPS_API_KEY (see README). */
@Composable
private fun MapPlaceholder(modifier: Modifier) {
    val c = EvTheme.colors
    Box(modifier.background(c.surfaceSunken), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(24.dp)) {
            Icon(EvIcons.Map, null, tint = c.muted, modifier = Modifier.size(32.dp))
            Text(stringResource(R.string.map_unavailable), style = EvTheme.type.caption, color = c.muted, textAlign = TextAlign.Center)
        }
    }
}

/**
 * Search map: black price pills for listings, black circles with a count for clusters (clustering is done in
 * :core), selected listing inverted. Reports the visible bbox + zoom (debounced) so the caller can query
 * GET /listings/map?bbox=…
 */
@OptIn(kotlinx.coroutines.FlowPreview::class)
@Composable
fun ListingsMap(
    markers: List<MapMarker>,
    center: LatLng,
    selectedId: String?,
    onViewport: (BBox, Float) -> Unit,
    onSelect: (String?) -> Unit,
    modifier: Modifier = Modifier,
    cameraState: CameraPositionState = rememberCameraPositionState { position = CameraPosition.fromLatLngZoom(center, 12f) },
) {
    if (!BuildConfig.MAPS_ENABLED) {
        MapPlaceholder(modifier)
        return
    }
    val scope = rememberCoroutineScope()
    val viewport by rememberUpdatedState(onViewport)
    LaunchedEffect(cameraState) {
        snapshotFlow { cameraState.isMoving to cameraState.position }
            .filter { !it.first }
            .debounce(300)
            .collect {
                val bounds = cameraState.projection?.visibleRegion?.latLngBounds ?: return@collect
                viewport(BBox(bounds.southwest.longitude, bounds.southwest.latitude, bounds.northeast.longitude, bounds.northeast.latitude), cameraState.position.zoom)
            }
    }
    val c = EvTheme.colors
    GoogleMap(
        modifier = modifier,
        cameraPositionState = cameraState,
        properties = rememberMapProperties(),
        uiSettings = remember { MapUiSettings(zoomControlsEnabled = false, mapToolbarEnabled = false, tiltGesturesEnabled = false, rotationGesturesEnabled = false) },
        onMapClick = { onSelect(null) },
    ) {
        markers.forEach { m ->
            when (m) {
                is MapMarker.Single -> {
                    val p = m.point
                    val selected = p.id == selectedId
                    val label = "${p.currency.symbol} ${Format.shortPrice(p.price)}"
                    MarkerComposable(
                        p.id, selected, label, c.ink,
                        state = rememberUpdatedMarkerState(LatLng(p.lat, p.lng)),
                        contentDescription = p.title.ifBlank { label },
                        anchor = Offset(0.5f, 0.5f),
                        zIndex = if (selected) 2f else if (p.isPremium || p.isVip) 1f else 0f,
                        onClick = { onSelect(p.id); true },
                    ) {
                        PricePill(label, selected, highlighted = p.isPremium || p.isVip)
                    }
                }
                is MapMarker.Cluster -> MarkerComposable(
                    m.key, m.count, c.ink,
                    state = rememberUpdatedMarkerState(LatLng(m.lat, m.lng)),
                    contentDescription = m.count.toString(),
                    anchor = Offset(0.5f, 0.5f),
                    onClick = {
                        scope.launch { cameraState.animate(CameraUpdateFactory.newLatLngZoom(LatLng(m.lat, m.lng), cameraState.position.zoom + 2f)) }
                        true
                    },
                ) {
                    ClusterDot(m.count)
                }
            }
        }
    }
}

@Composable
private fun PricePill(text: String, selected: Boolean, highlighted: Boolean) {
    val c = EvTheme.colors
    Box(
        Modifier
            .clip(RoundedCornerShape(50))
            .background(if (selected) c.ink else c.surfaceRaised)
            .border(1.dp, if (highlighted && !selected) c.accentStrong else c.hairline, RoundedCornerShape(50))
            .padding(horizontal = 10.dp, vertical = 5.dp),
    ) {
        Text(text, style = EvTheme.type.micro, color = if (selected) c.onInk else c.ink)
    }
}

@Composable
private fun ClusterDot(count: Int) {
    val c = EvTheme.colors
    Box(
        Modifier.size(if (count >= 100) 46.dp else 38.dp).clip(CircleShape).background(c.ink).border(3.dp, c.accent.copy(alpha = 0.6f), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(if (count > 999) "999+" else count.toString(), style = EvTheme.type.label, color = c.onInk)
    }
}

/** Small non-interactive map with one pin (listing detail "Location"). Lite mode = a static bitmap, cheap in lists. */
@Composable
fun StaticPinMap(lat: Double, lng: Double, modifier: Modifier = Modifier, contentDescription: String? = null) {
    if (!BuildConfig.MAPS_ENABLED) {
        MapPlaceholder(modifier)
        return
    }
    val pos = LatLng(lat, lng)
    val camera = rememberCameraPositionState { position = CameraPosition.fromLatLngZoom(pos, 14f) }
    GoogleMap(
        modifier = modifier,
        cameraPositionState = camera,
        contentDescription = contentDescription,
        googleMapOptionsFactory = { GoogleMapOptions().liteMode(true) },
        properties = rememberMapProperties(),
        uiSettings = remember { MapUiSettings(zoomControlsEnabled = false, mapToolbarEnabled = false, scrollGesturesEnabled = false, zoomGesturesEnabled = false) },
    ) {
        MarkerComposable(pos, state = rememberUpdatedMarkerState(pos), anchor = Offset(0.5f, 0.5f)) {
            Box(Modifier.size(28.dp).clip(CircleShape).background(EvTheme.colors.ink).padding(7.dp)) {
                Box(Modifier.fillMaxSize().clip(CircleShape).background(EvTheme.colors.accent))
            }
        }
    }
}

/** Post wizard: tap the map or drag the pin; [target] moves the camera (e.g. "my location", city change). */
@Composable
fun PinPickerMap(
    pin: LatLng?,
    center: LatLng,
    onPinChange: (LatLng) -> Unit,
    modifier: Modifier = Modifier,
    myLocationEnabled: Boolean = false,
) {
    if (!BuildConfig.MAPS_ENABLED) {
        MapPlaceholder(modifier)
        return
    }
    val camera = rememberCameraPositionState { position = CameraPosition.fromLatLngZoom(pin ?: center, if (pin != null) 15f else 12f) }
    LaunchedEffect(center) {
        if (pin == null) camera.animate(CameraUpdateFactory.newLatLngZoom(center, 12f))
    }
    LaunchedEffect(pin) {
        if (pin != null) camera.animate(CameraUpdateFactory.newLatLngZoom(pin, maxOf(camera.position.zoom, 15f)))
    }
    val markerState = remember { MarkerState(position = pin ?: center) }
    LaunchedEffect(pin) { if (pin != null) markerState.position = pin }
    val dragging = markerState.isDragging
    LaunchedEffect(dragging) {
        if (!dragging && pin != null && markerState.position != pin) onPinChange(markerState.position)
    }
    GoogleMap(
        modifier = modifier,
        cameraPositionState = camera,
        properties = rememberMapProperties(myLocation = myLocationEnabled),
        uiSettings = remember(myLocationEnabled) { MapUiSettings(zoomControlsEnabled = false, mapToolbarEnabled = false, myLocationButtonEnabled = false) },
        onMapClick = { onPinChange(it) },
    ) {
        if (pin != null) {
            MarkerComposable(state = markerState, draggable = true, anchor = Offset(0.5f, 1f)) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.size(34.dp).clip(CircleShape).background(EvTheme.colors.ink), contentAlignment = Alignment.Center) {
                        Icon(EvIcons.Home, null, tint = EvTheme.colors.onInk, modifier = Modifier.size(18.dp))
                    }
                    Box(Modifier.size(width = 3.dp, height = 10.dp).background(EvTheme.colors.ink))
                }
            }
        }
    }
}
