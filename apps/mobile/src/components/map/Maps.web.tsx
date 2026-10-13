/**
 * Web fallback (react-native-maps is native-only). Renders a stylised placeholder with the
 * price markers laid out by coordinates so web previews/screenshots stay meaningful.
 */
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { brand } from '../../theme';
import type { ListingsMapProps, PinMapProps, StaticMapProps } from './types';

const Grid = () => (
  <View style={[StyleSheet.absoluteFill, { backgroundColor: '#E8F0EC' }]}>
    {Array.from({ length: 8 }).map((_, i) => (
      <View key={`h${i}`} style={{ position: 'absolute', left: 0, right: 0, top: `${(i + 1) * 11}%`, height: 1, backgroundColor: '#D4E2DB' }} />
    ))}
    {Array.from({ length: 6 }).map((_, i) => (
      <View key={`v${i}`} style={{ position: 'absolute', top: 0, bottom: 0, left: `${(i + 1) * 14}%`, width: 1, backgroundColor: '#D4E2DB' }} />
    ))}
  </View>
);

export function ListingsMap({ style, initialRegion, markers, onRegionChangeComplete, onMarkerPress }: ListingsMapProps) {
  useEffect(() => {
    onRegionChangeComplete(initialRegion);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const r = initialRegion;
  return (
    <View style={[StyleSheet.absoluteFill, style]}>
      <Grid />
      {markers.map((m) => {
        const x = ((m.lng - (r.longitude - r.longitudeDelta / 2)) / r.longitudeDelta) * 100;
        const y = (1 - (m.lat - (r.latitude - r.latitudeDelta / 2)) / r.latitudeDelta) * 100;
        if (x < 0 || x > 100 || y < 0 || y > 100) return null;
        const bg = m.selected ? brand.primaryDark : m.tone === 'premium' ? brand.premium : m.tone === 'vip' ? brand.vip : brand.primary;
        return (
          <Pressable key={m.id} onPress={() => onMarkerPress(m.id)} style={[styles.tag, { left: `${x}%`, top: `${y}%`, backgroundColor: bg }]}>
            <Text style={{ color: m.tone === 'vip' && !m.selected ? '#1F1300' : '#fff', fontWeight: '700', fontSize: 12 }}>{m.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function PinMap({ style, value, onChange, center }: PinMapProps) {
  return (
    <Pressable style={[style, { overflow: 'hidden' }]} onPress={() => onChange(value ?? center)}>
      <Grid />
      <View style={{ position: 'absolute', left: '50%', top: '50%', marginLeft: -12, marginTop: -24 }}>
        <Text style={{ fontSize: 28, color: brand.primary }}>📍</Text>
      </View>
    </Pressable>
  );
}

export function StaticMap({ style }: StaticMapProps) {
  return (
    <View style={[style, { overflow: 'hidden' }]}>
      <Grid />
      <View style={{ position: 'absolute', left: '50%', top: '50%', marginLeft: -12, marginTop: -24 }}>
        <Text style={{ fontSize: 28 }}>📍</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: { position: 'absolute', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, borderWidth: 1.5, borderColor: '#fff' },
});
