'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ds/feedback';

const loading = () => <Skeleton className="h-full min-h-[260px] w-full rounded-none" />;

export const SearchMap = dynamic(() => import('./LeafletMaps').then((m) => m.SearchMap), { ssr: false, loading });
export const LocationMap = dynamic(() => import('./LeafletMaps').then((m) => m.LocationMap), { ssr: false, loading });
export const LocationPicker = dynamic(() => import('./LeafletMaps').then((m) => m.LocationPicker), { ssr: false, loading });
