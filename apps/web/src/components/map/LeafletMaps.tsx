'use client';

/**
 * Leaflet maps (client only — imported through next/dynamic with ssr:false, see ./index.tsx).
 * OpenStreetMap tiles; price markers are lightweight divIcons.
 */
import L from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { currencySymbol, type MapPoint } from '@evtap/shared';

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export const compactPrice = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

const pinIcon = L.divIcon({
  className: 'leaflet-div-icon price-icon',
  html: `<svg width="34" height="44" viewBox="0 0 34 44" style="transform:translate(-50%,-100%);display:block"><path d="M17 43s15-14.2 15-26A15 15 0 0 0 2 17c0 11.8 15 26 15 26z" fill="#0E7C66" stroke="#fff" stroke-width="2"/><circle cx="17" cy="17" r="6" fill="#fff"/></svg>`,
  iconSize: [0, 0],
});

function priceIcon(p: MapPoint) {
  const cls = p.isPremium ? 'premium' : p.isVip ? 'vip' : '';
  return L.divIcon({
    className: 'leaflet-div-icon price-icon',
    html: `<span class="price-marker ${cls}">${compactPrice(p.price)} ${currencySymbol(p.currency)}</span>`,
    iconSize: [0, 0],
  });
}

function BoundsWatcher({ onChange }: { onChange: (bbox: string, zoom: number) => void }) {
  const map = useMapEvents({
    moveend: () => emit(),
    zoomend: () => emit(),
  });
  const emit = () => {
    const b = map.getBounds();
    const f = (n: number) => n.toFixed(5);
    onChange(`${f(b.getWest())},${f(b.getSouth())},${f(b.getEast())},${f(b.getNorth())}`, map.getZoom());
  };
  useEffect(() => {
    emit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function Recenter({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    map.setView(center, zoom);
  }, [center[0], center[1], zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function SearchMap({
  center, zoom = 12, points, onBoundsChange, openLabel, listingHref, priceLabel,
}: {
  center: [number, number];
  zoom?: number;
  points: MapPoint[];
  onBoundsChange: (bbox: string, zoom: number) => void;
  openLabel: string;
  listingHref: (id: string) => string;
  priceLabel: (p: MapPoint) => string;
}) {
  const icons = useMemo(() => new Map(points.map((p) => [p.id, priceIcon(p)])), [points]);
  return (
    <MapContainer center={center} zoom={zoom} scrollWheelZoom className="h-full w-full" style={{ minHeight: 360 }}>
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
      <BoundsWatcher onChange={onBoundsChange} />
      <Recenter center={center} zoom={zoom} />
      {points.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lng]} icon={icons.get(p.id)!} zIndexOffset={p.isPremium ? 300 : p.isVip ? 200 : 0}>
          <Popup>
            <div className="min-w-36 text-sm">
              <div className="font-bold">{priceLabel(p)}</div>
              <a href={listingHref(p.id)} className="mt-1 inline-block font-semibold text-brand">
                {openLabel} →
              </a>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

export function LocationMap({ lat, lng, zoom = 15 }: { lat: number; lng: number; zoom?: number }) {
  return (
    <MapContainer center={[lat, lng]} zoom={zoom} scrollWheelZoom={false} className="h-full w-full" style={{ minHeight: 260 }}>
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
      <Marker position={[lat, lng]} icon={pinIcon} />
    </MapContainer>
  );
}

function ClickToSet({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

/** Map with a draggable pin (listing wizard). */
export function LocationPicker({ lat, lng, center, zoom = 13, onChange }: { lat: number | null; lng: number | null; center: [number, number]; zoom?: number; onChange: (lat: number, lng: number) => void }) {
  const pos: [number, number] | null = lat != null && lng != null ? [lat, lng] : null;
  const view = pos ?? center;
  return (
    <MapContainer center={view} zoom={pos ? 15 : zoom} scrollWheelZoom className="h-full w-full" style={{ minHeight: 300 }}>
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
      <Recenter center={view} zoom={pos ? 15 : zoom} />
      <ClickToSet onPick={onChange} />
      {pos && (
        <Marker
          position={pos}
          icon={pinIcon}
          draggable
          eventHandlers={{
            dragend: (e) => {
              const ll = (e.target as L.Marker).getLatLng();
              onChange(Number(ll.lat.toFixed(6)), Number(ll.lng.toFixed(6)));
            },
          }}
        />
      )}
    </MapContainer>
  );
}
