import type { StyleProp, ViewStyle } from 'react-native';

export type LatLng = { latitude: number; longitude: number };
export type MapRegion = LatLng & { latitudeDelta: number; longitudeDelta: number };

export type PriceMarker = { id: string; lat: number; lng: number; label: string; tone: 'default' | 'vip' | 'premium'; selected?: boolean };

export type ListingsMapProps = {
  style?: StyleProp<ViewStyle>;
  initialRegion: MapRegion;
  markers: PriceMarker[];
  onRegionChangeComplete: (r: MapRegion) => void;
  onMarkerPress: (id: string) => void;
  onMapPress?: () => void;
};

export type PinMapProps = {
  style?: StyleProp<ViewStyle>;
  value: LatLng | null;
  center: LatLng;
  onChange: (p: LatLng) => void;
};

export type StaticMapProps = { style?: StyleProp<ViewStyle>; lat: number; lng: number };

/** bbox string for GET /listings/map: "minLng,minLat,maxLng,maxLat". */
export const regionToBbox = (r: MapRegion) => {
  const f = (n: number) => n.toFixed(5);
  return [r.longitude - r.longitudeDelta / 2, r.latitude - r.latitudeDelta / 2, r.longitude + r.longitudeDelta / 2, r.latitude + r.latitudeDelta / 2].map(f).join(',');
};
