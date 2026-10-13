/**
 * react-native-maps wrappers. iOS → Apple Maps (no key). Android → Google Maps
 * (key: GOOGLE_MAPS_ANDROID_API_KEY → app.config.ts `android.config.googleMaps.apiKey`).
 * A `.web.tsx` sibling provides a lightweight fallback for web previews.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { brand } from '../../theme';
import type { ListingsMapProps, PinMapProps, PriceMarker, StaticMapProps } from './types';

const PriceTag = memo(function PriceTag({ m }: { m: PriceMarker }) {
  const bg = m.selected ? brand.primaryDark : m.tone === 'premium' ? brand.premium : m.tone === 'vip' ? brand.vip : brand.primary;
  const fg = m.tone === 'vip' && !m.selected ? '#1F1300' : '#fff';
  return (
    <View style={[styles.tag, { backgroundColor: bg, transform: [{ scale: m.selected ? 1.1 : 1 }] }]}>
      <Text style={[styles.tagText, { color: fg }]}>{m.label}</Text>
    </View>
  );
});

export function ListingsMap({ style, initialRegion, markers, onRegionChangeComplete, onMarkerPress, onMapPress }: ListingsMapProps) {
  // Custom marker views need tracksViewChanges=true for the first render on Android, then false for performance.
  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    setTracks(true);
    const t = setTimeout(() => setTracks(false), 600);
    return () => clearTimeout(t);
  }, [markers]);
  return (
    <MapView
      style={[StyleSheet.absoluteFill, style]}
      initialRegion={initialRegion}
      onRegionChangeComplete={(r: Region) => onRegionChangeComplete(r)}
      onPress={onMapPress}
      showsUserLocation
      showsMyLocationButton
      toolbarEnabled={false}
      rotateEnabled={false}
      pitchEnabled={false}
    >
      {markers.map((m) => (
        <Marker
          key={m.id}
          identifier={m.id}
          coordinate={{ latitude: m.lat, longitude: m.lng }}
          onPress={(e) => {
            e.stopPropagation?.();
            onMarkerPress(m.id);
          }}
          tracksViewChanges={tracks}
          zIndex={m.selected ? 100 : m.tone === 'premium' ? 3 : m.tone === 'vip' ? 2 : 1}
        >
          <PriceTag m={m} />
        </Marker>
      ))}
    </MapView>
  );
}

export function PinMap({ style, value, center, onChange }: PinMapProps) {
  const ref = useRef<MapView>(null);
  useEffect(() => {
    const target = value ?? center;
    ref.current?.animateToRegion({ ...target, latitudeDelta: value ? 0.01 : 0.08, longitudeDelta: value ? 0.01 : 0.08 }, 350);
  }, [center.latitude, center.longitude, value?.latitude, value?.longitude]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <MapView
      ref={ref}
      style={style}
      initialRegion={{ ...(value ?? center), latitudeDelta: 0.08, longitudeDelta: 0.08 }}
      onPress={(e) => onChange(e.nativeEvent.coordinate)}
      showsUserLocation
      toolbarEnabled={false}
    >
      {value && <Marker coordinate={value} draggable onDragEnd={(e) => onChange(e.nativeEvent.coordinate)} pinColor={brand.primary} />}
    </MapView>
  );
}

export function StaticMap({ style, lat, lng }: StaticMapProps) {
  return (
    <MapView
      style={style}
      initialRegion={{ latitude: lat, longitude: lng, latitudeDelta: 0.012, longitudeDelta: 0.012 }}
      scrollEnabled={false}
      zoomEnabled={false}
      rotateEnabled={false}
      pitchEnabled={false}
      toolbarEnabled={false}
      liteMode
      pointerEvents="none"
    >
      <Marker coordinate={{ latitude: lat, longitude: lng }} pinColor={brand.primary} />
    </MapView>
  );
}

const styles = StyleSheet.create({
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  tagText: { fontSize: 12, fontWeight: '700' },
});
