import { Alert, Linking, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { uploadFile } from '../api/client';
import { absUrl } from '../config';
import { useI18n } from '../i18n';
import { brand, radius, spacing, useTheme } from '../theme';
import { Button, Text } from '../components/ui';
import { useToast } from '../components/Toast';
import type { Photo } from './draft';

const MAX = 30;
const MAX_WIDTH = 1600;

/** Resize to ≤1600px wide and re-encode as JPEG (~80%) before upload — keeps uploads well under the 10MB limit. */
async function compress(asset: ImagePicker.ImagePickerAsset) {
  const ctx = ImageManipulator.manipulate(asset.uri);
  if (asset.width > MAX_WIDTH) ctx.resize({ width: MAX_WIDTH });
  const img = await ctx.renderAsync();
  const res = await img.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
  return res.uri;
}

export function PhotosStep({ photos, setPhotos, error }: { photos: Photo[]; setPhotos: (fn: (p: Photo[]) => Photo[]) => void; error?: string }) {
  const { c } = useTheme();
  const { t } = useI18n();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const size = (width - spacing.lg * 2 - spacing.sm * 2) / 3;

  const update = (key: string, patch: Partial<Photo>) => setPhotos((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const upload = async (photo: Photo, asset: ImagePicker.ImagePickerAsset) => {
    try {
      const uri = await compress(asset);
      const up = await uploadFile({ uri, name: `photo-${photo.key}.jpg`, type: 'image/jpeg' }, (p) => update(photo.key, { progress: p }));
      update(photo.key, { uploadId: up.id, url: up.thumbUrl || up.url, progress: 1, error: false });
    } catch (e) {
      update(photo.key, { error: true });
      toast.error(e);
    }
  };

  const add = async (assets: ImagePicker.ImagePickerAsset[]) => {
    const room = MAX - photos.length;
    const items = assets.slice(0, room).map((a) => ({ asset: a, photo: { key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, localUri: a.uri, progress: 0 } as Photo }));
    setPhotos((ps) => [...ps, ...items.map((i) => i.photo)]);
    // Upload sequentially-ish (2 at a time) to keep mobile networks happy.
    for (let i = 0; i < items.length; i += 2) await Promise.all(items.slice(i, i + 2).map((x) => upload(x.photo, x.asset)));
  };

  const denied = () =>
    Alert.alert(t('post.permissionDenied'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('profile.settings'), onPress: () => Linking.openSettings() },
    ]);

  const pickGallery = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted && perm.accessPrivileges !== 'limited') return denied();
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX - photos.length,
      orderedSelection: true,
      quality: 1,
      exif: false,
    });
    if (!r.canceled) add(r.assets);
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return denied();
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false });
    if (!r.canceled) add(r.assets);
  };

  const move = (i: number, dir: -1 | 1) =>
    setPhotos((ps) => {
      const j = i + dir;
      if (j < 0 || j >= ps.length) return ps;
      const next = ps.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const makeCover = (i: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setPhotos((ps) => [ps[i], ...ps.filter((_, k) => k !== i)]);
  };

  return (
    <View style={{ gap: spacing.md }}>
      <Text variant="h2">{t('post.addPhotos')}</Text>
      <Text muted>{t('post.photosHint')}</Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button title={t('post.gallery')} icon="images-outline" kind="secondary" style={{ flex: 1 }} onPress={pickGallery} disabled={photos.length >= MAX} />
        <Button title={t('post.camera')} icon="camera-outline" kind="secondary" style={{ flex: 1 }} onPress={takePhoto} disabled={photos.length >= MAX} />
      </View>
      {!!error && <Text color={c.danger}>{error}</Text>}
      <Text variant="small" muted>
        {photos.length} / {MAX}
      </Text>
      <View style={styles.grid}>
        {photos.map((p, i) => (
          <Pressable
            key={p.key}
            onLongPress={() => makeCover(i)}
            delayLongPress={350}
            accessibilityLabel={`${i + 1}`}
            accessibilityHint={t('post.makeCover')}
            style={[styles.cell, { width: size, height: size, borderColor: i === 0 ? brand.primary : c.border }]}
          >
            <Image source={{ uri: p.localUri ?? absUrl(p.url) }} style={StyleSheet.absoluteFill} contentFit="cover" />
            {p.progress < 1 && !p.error && (
              <View style={styles.progressWrap}>
                <View style={[styles.progress, { width: `${Math.round(p.progress * 100)}%`, backgroundColor: brand.primary }]} />
                <Text variant="caption" color="#fff" style={styles.progressText}>
                  {t('post.uploading', { p: Math.round(p.progress * 100) })}
                </Text>
              </View>
            )}
            {p.error && (
              <View style={[styles.progressWrap, { backgroundColor: 'rgba(229,72,77,0.8)', top: 0, justifyContent: 'center', alignItems: 'center' }]}>
                <Ionicons name="alert-circle" size={24} color="#fff" />
                <Text variant="caption" color="#fff">
                  {t('post.uploadFailed')}
                </Text>
              </View>
            )}
            {i === 0 && (
              <View style={[styles.cover, { backgroundColor: brand.primary }]}>
                <Text variant="caption" color="#fff" style={{ fontWeight: '700' }}>
                  {t('post.cover')}
                </Text>
              </View>
            )}
            <Pressable onPress={() => setPhotos((ps) => ps.filter((x) => x.key !== p.key))} hitSlop={6} style={styles.remove} accessibilityLabel={t('common.delete')} accessibilityRole="button">
              <Ionicons name="close" size={16} color="#fff" />
            </Pressable>
            <View style={styles.arrows}>
              <Pressable onPress={() => move(i, -1)} disabled={i === 0} hitSlop={4} style={styles.arrow} accessibilityLabel="←" accessibilityRole="button">
                <Ionicons name="chevron-back" size={16} color={i === 0 ? '#999' : '#fff'} />
              </Pressable>
              <Pressable onPress={() => move(i, 1)} disabled={i === photos.length - 1} hitSlop={4} style={styles.arrow} accessibilityLabel="→" accessibilityRole="button">
                <Ionicons name="chevron-forward" size={16} color={i === photos.length - 1 ? '#999' : '#fff'} />
              </Pressable>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cell: { borderRadius: radius.sm, overflow: 'hidden', borderWidth: 2 },
  progressWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 22, backgroundColor: 'rgba(0,0,0,0.55)' },
  progress: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  progressText: { textAlign: 'center', lineHeight: 22 },
  cover: { position: 'absolute', left: 4, top: 4, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  remove: { position: 'absolute', right: 4, top: 4, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  arrows: { position: 'absolute', left: 4, right: 4, bottom: 26, flexDirection: 'row', justifyContent: 'space-between' },
  arrow: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
});
