import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useMutation } from '@tanstack/react-query';
import { formatPhone, updateMeSchema } from '@evtap/shared';
import { api, uploadFile } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { RequireAuth } from '@/auth/RequireAuth';
import { useI18n } from '@/i18n';
import { spacing, useTheme } from '@/theme';
import { Avatar, Button, Field, Text } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { absUrl } from '@/config';

export default function EditProfileScreen() {
  return (
    <RequireAuth>
      <EditProfile />
    </RequireAuth>
  );
}

function EditProfile() {
  const { c } = useTheme();
  const { t } = useI18n();
  const toast = useToast();
  const { me, refetchMe } = useAuth();
  const [name, setName] = useState(me?.name ?? '');
  const [email, setEmail] = useState(me?.email ?? '');
  const [avatar, setAvatar] = useState<string | null>(me?.avatarUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (me) {
      setName(me.name);
      setEmail(me.email ?? '');
      setAvatar(me.avatarUrl);
    }
  }, [me]);

  const save = useMutation({
    mutationFn: async () => {
      const body = { name: name.trim(), email: email.trim() || undefined, avatarUrl: avatar ? absUrl(avatar) ?? null : null };
      const p = updateMeSchema.safeParse(body);
      if (!p.success) {
        setErrors(Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message])));
        throw new Error('validation');
      }
      return api.updateMe(p.data);
    },
    onSuccess: () => {
      refetchMe();
      toast.success(t('common.saved'));
      router.back();
    },
    onError: (e) => (e as Error).message !== 'validation' && toast.error(e),
  });

  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
    if (r.canceled) return;
    setUploading(true);
    try {
      const img = await ImageManipulator.manipulate(r.assets[0].uri).resize({ width: 512 }).renderAsync();
      const saved = await img.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
      const up = await uploadFile({ uri: saved.uri, name: 'avatar.jpg', type: 'image/jpeg' });
      setAvatar(up.url);
    } catch (e) {
      toast.error(e);
    } finally {
      setUploading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={pick} style={{ alignItems: 'center', gap: spacing.sm }} accessibilityRole="button" accessibilityLabel={t('settings.changeAvatar')}>
          <Avatar uri={avatar} name={name} size={96} />
          <Text color={c.primary} style={{ fontWeight: '600' }}>
            {uploading ? t('common.loading') : t('settings.changeAvatar')}
          </Text>
        </Pressable>
        <Field label={t('settings.name')} value={name} onChangeText={setName} error={errors.name} autoComplete="name" />
        <Field label={t('settings.email')} value={email} onChangeText={setEmail} error={errors.email} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
        {me?.phone && <Field label={t('auth.phone')} value={formatPhone(me.phone)} editable={false} />}
        <Button title={t('common.save')} loading={save.isPending} disabled={uploading} onPress={() => save.mutate()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
