import { useState } from 'react';
import { FlatList, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { qk } from '@/api/queryClient';
import { absUrl } from '@/config';
import { useI18n } from '@/i18n';
import { IconButton, Text } from '@/components/ui';

/** Full-screen swipeable gallery (pinch-to-zoom on iOS via ScrollView zoom). */
export default function Gallery() {
  const { id, index } = useLocalSearchParams<{ id: string; index?: string }>();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const q = useQuery({ queryKey: qk.listing(id), queryFn: () => api.listing(id) });
  const images = [...(q.data?.images ?? [])].sort((a, b) => a.order - b.order);
  const [current, setCurrent] = useState(Number(index ?? 0));

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar style="light" />
      <FlatList
        data={images}
        horizontal
        pagingEnabled
        initialScrollIndex={Math.min(Number(index ?? 0), Math.max(images.length - 1, 0))}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        keyExtractor={(i) => i.id}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setCurrent(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => (
          <ScrollView
            style={{ width, height }}
            contentContainerStyle={{ flex: 1, justifyContent: 'center' }}
            maximumZoomScale={Platform.OS === 'ios' ? 4 : 1}
            minimumZoomScale={1}
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            centerContent
          >
            <Image source={{ uri: absUrl(item.url) }} placeholder={{ uri: absUrl(item.thumbUrl) }} style={{ width, height: height * 0.8 }} contentFit="contain" />
          </ScrollView>
        )}
      />
      <View style={[styles.top, { top: insets.top + 8 }]}>
        <IconButton name="close" label={t('common.close')} color="#fff" bg="rgba(255,255,255,0.15)" onPress={() => router.back()} />
        {images.length > 0 && (
          <Text color="#fff" style={{ fontWeight: '600' }}>
            {current + 1} / {images.length}
          </Text>
        )}
        <View style={{ width: 44 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
