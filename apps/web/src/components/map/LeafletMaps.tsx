'use client';

/**
 * Leaflet maps (client only — loaded through next/dynamic with ssr:false, see ./index.tsx).
 * Monochrome MapCard styling (globals.css): grayscale tiles, white price pills, black count clusters, peach radial
 * glow around the selected point. Clustering is a light greedy pixel grouping recomputed on zoom / move.
 */
import L from 'leaflet';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import { currencySymbol, type MapPoint } from '@evtap/shared';
import { assetUrl } from '@/lib/config';

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const CLUSTER_PX = 56;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const compactPrice = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 2).replace(/\.?0+$/, '')}M` : n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(n);

const HOUSE_SVG =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

const pinIcon = () => L.divIcon({ className: 'leaflet-div-icon ds-marker', html: `<span class="ds-pin">${HOUSE_SVG}</span>`, iconSize: [0, 0] });
const glowIcon = (size: number) => L.divIcon({ className: 'leaflet-div-icon ds-marker', html: `<div class="ds-glow" style="width:${size}px;height:${size}px"></div>`, iconSize: [0, 0] });

function priceIcon(p: MapPoint, active: boolean) {
  const cls = ['ds-price', p.isVip || p.isPremium ? 'is-vip' : '', active ? 'is-active' : ''].join(' ');
  return L.divIcon({
    className: 'leaflet-div-icon ds-marker',
    html: `<span class="${cls}" title="${esc(p.title ?? '')}"><span class="cur">${esc(currencySymbol(p.currency))}</span>${compactPrice(p.price)}</span>`,
    iconSize: [0, 0],
  });
}

function clusterIcon(count: number, min: number, max: number, cur: string) {
  const size = count < 10 ? 36 : count < 50 ? 42 : 50;
  const range = min === max ? compactPrice(min) : `${compactPrice(min)} – ${compactPrice(max)}`;
  return L.divIcon({
    className: 'leaflet-div-icon ds-marker',
    html: `<div style="position:relative"><span class="ds-price" style="position:absolute;left:0;top:-${size / 2 + 18}px"><span class="cur">${esc(cur)}</span>${range}</span><span class="ds-cluster" style="width:${size}px;height:${size}px">${count}</span></div>`,
    iconSize: [0, 0],
  });
}

interface Cluster { key: string; lat: number; lng: number; points: MapPoint[] }

function useClusters(points: MapPoint[]) {
  const map = useMap();
  const [tick, setTick] = useState(0);
  useMapEvents({ zoomend: () => setTick((t) => t + 1) });
  return useMemo(() => {
    void tick;
    const out: (Cluster & { x: number; y: number })[] = [];
    for (const p of points) {
      const pt = map.latLngToLayerPoint([p.lat, p.lng]);
      const hit = out.find((c) => Math.abs(c.x - pt.x) < CLUSTER_PX && Math.abs(c.y - pt.y) < CLUSTER_PX);
      if (hit) {
        hit.points.push(p);
        const n = hit.points.length;
        hit.lat += (p.lat - hit.lat) / n;
        hit.lng += (p.lng - hit.lng) / n;
      } else out.push({ key: p.id, lat: p.lat, lng: p.lng, x: pt.x, y: pt.y, points: [p] });
    }
    return out as Cluster[];
  }, [points, map, tick]);
}

function BoundsWatcher({ onChange }: { onChange: (bbox: string, zoom: number) => void }) {
  const map = useMapEvents({ moveend: () => emit(), zoomend: () => emit() });
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

/** Invalidate size when the container is resized (MapCard expand / layout switches). */
function AutoResize() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

function PointsLayer({ points, listingHref, priceLabel, openLabel, activeId, onActive }: { points: MapPoint[]; listingHref: (id: string) => string; priceLabel: (p: MapPoint) => string; openLabel: string; activeId: string | null; onActive: (id: string | null) => void }) {
  const map = useMap();
  const clusters = useClusters(points);
  const active = points.find((p) => p.id === activeId) ?? null;
  return (
    <>
      {active && <Marker position={[active.lat, active.lng]} icon={glowIcon(280)} interactive={false} keyboard={false} zIndexOffset={-1000} />}
      {clusters.map((c) => {
        if (c.points.length > 1) {
          const prices = c.points.map((p) => p.price);
          return (
            <Marker
              key={`c-${c.key}-${c.points.length}`}
              position={[c.lat, c.lng]}
              icon={clusterIcon(c.points.length, Math.min(...prices), Math.max(...prices), currencySymbol(c.points[0]!.currency))}
              eventHandlers={{ click: () => map.flyTo([c.lat, c.lng], Math.min(map.getZoom() + 2, 18), { duration: 0.4 }) }}
              title={`${c.points.length}`}
            />
          );
        }
        const p = c.points[0]!;
        const cover = assetUrl(p.coverUrl);
        return (
          <Marker
            key={p.id}
            position={[p.lat, p.lng]}
            icon={priceIcon(p, p.id === activeId)}
            zIndexOffset={p.id === activeId ? 600 : p.isPremium ? 300 : p.isVip ? 200 : 0}
            eventHandlers={{ popupopen: () => onActive(p.id), popupclose: () => onActive(null) }}
            title={p.title}
          >
            <Popup closeButton autoPanPadding={[24, 24]}>
              <Link href={listingHref(p.id)} className="block text-ink no-underline">
                <div className="relative aspect-[16/10] w-full bg-surface-sunken">
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cover} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : null}
                </div>
                <div className="flex flex-col gap-1 p-3">
                  <span className="line-clamp-2 text-[13px] font-medium leading-snug">{p.title}</span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[14px] font-medium">{priceLabel(p)}</span>
                    <span className="inline-flex h-7 items-center rounded-full bg-ink px-3 text-[11px] font-medium text-on-ink">{openLabel} ↗</span>
                  </span>
                </div>
              </Link>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

export function SearchMap({
  center, zoom = 12, points, onBoundsChange, openLabel, listingHref, priceLabel, activeId: activeProp, onActiveChange,
}: {
  center: [number, number];
  zoom?: number;
  points: MapPoint[];
  onBoundsChange: (bbox: string, zoom: number) => void;
  openLabel: string;
  listingHref: (id: string) => string;
  priceLabel: (p: MapPoint) => string;
  activeId?: string | null;
  onActiveChange?: (id: string | null) => void;
}) {
  const [inner, setInner] = useState<string | null>(null);
  const activeId = activeProp ?? inner;
  const setActive = (id: string | null) => (onActiveChange ? onActiveChange(id) : setInner(id));
  return (
    <MapContainer center={center} zoom={zoom} scrollWheelZoom zoomControl={false} className="map-mono h-full w-full" style={{ minHeight: 360 }}>
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
      <ZoomControl position="bottomright" />
      <BoundsWatcher onChange={onBoundsChange} />
      <Recenter center={center} zoom={zoom} />
      <AutoResize />
      <PointsLayer points={points} listingHref={listingHref} priceLabel={priceLabel} openLabel={openLabel} activeId={activeId} onActive={setActive} />
    </MapContainer>
  );
}

export function LocationMap({ lat, lng, zoom = 15 }: { lat: number; lng: number; zoom?: number }) {
  const icon = useMemo(() => pinIcon(), []);
  const glow = useMemo(() => glowIcon(220), []);
  return (
    <MapContainer center={[lat, lng]} zoom={zoom} scrollWheelZoom={false} zoomControl={false} className="map-mono h-full w-full" style={{ minHeight: 260 }}>
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
      <ZoomControl position="bottomright" />
      <AutoResize />
      <Marker position={[lat, lng]} icon={glow} interactive={false} keyboard={false} zIndexOffset={-1000} />
      <Marker position={[lat, lng]} icon={icon} keyboard={false} />
    </MapContainer>
  );
}

function ClickToSet({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))) });
  return null;
}

/** Map with a draggable pin (listing wizard). */
export function LocationPicker({ lat, lng, center, zoom = 13, onChange }: { lat: number | null; lng: number | null; center: [number, number]; zoom?: number; onChange: (lat: number, lng: number) => void }) {
  const pos: [number, number] | null = lat != null && lng != null ? [lat, lng] : null;
  const view = pos ?? center;
  const icon = useMemo(() => pinIcon(), []);
  return (
    <MapContainer center={view} zoom={pos ? 15 : zoom} scrollWheelZoom zoomControl={false} className="map-mono h-full w-full" style={{ minHeight: 300 }}>
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
      <ZoomControl position="bottomright" />
      <Recenter center={view} zoom={pos ? 15 : zoom} />
      <AutoResize />
      <ClickToSet onPick={onChange} />
      {pos && (
        <Marker
          position={pos}
          icon={icon}
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
