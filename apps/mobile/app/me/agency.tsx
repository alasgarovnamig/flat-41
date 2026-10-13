import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CITIES, agencySchema, type Agency, type AgencyInput } from '@evtap/shared';
import { api, uploadFile } from '@/api/client';
import { qk } from '@/api/queryClient';
import { RequireAuth } from '@/auth/RequireAuth';
import { useI18n } from '@/i18n';
import { spacing, useTheme } from '@/theme';
import { Avatar, Button, ErrorState, Field, Loading, Segmented, StatusPill, Text } from '@/components/ui';
import { Select } from '@/components/Select';
import { useToast } from '@/components/Toast';
import { isNotFound } from '@/lib/errors';
import { formatLocalPhone, toLocalDigits } from '@/lib/phone';

export default function AgencyScreen() {
  return (
    <RequireAuth>
      <AgencyProfile />
    </RequireAuth>
  );
}

type Form = { name: string; type: 'AGENCY' | 'DEVELOPER'; description: string; phone: string; email: string; website: string; address: string; cityId: string | null; logoUrl: string | null };
const toForm = (a?: Agency): Form => ({
  name: a?.name ?? '', type: a?.type ?? 'AGENCY', description: a?.description ?? '', phone: toLocalDigits(a?.phone), email: a?.email ?? '',
  website: a?.website ?? '', address: a?.address ?? '', cityId: a?.cityId ?? 'baku', logoUrl: a?.logoUrl ?? null,
});

function AgencyProfile() {
  const { c } = useTheme();
  const { t, te, ln } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.myAgency, queryFn: api.myAgency, retry: false });
  const exists = !!q.data;
  const [f, setF] = useState<Form>(toForm());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    if (q.data) setF(toForm(q.data));
  }, [q.data]);
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const input: AgencyInput = {
        name: f.name, type: f.type, description: f.description || null, phone: f.phone ? `+994${f.phone}` : null, email: f.email || null,
        website: f.website || null, address: f.address || null, cityId: f.cityId, logoUrl: f.logoUrl,
      };
      const p = agencySchema.safeParse(input);
      if (!p.success) {
        setErrors(Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message])));
        throw new Error('validation');
      }
      setErrors({});
      return exists ? api.updateMyAgency(p.data) : api.createAgency(p.data);
    },
    onSuccess: (a) => {
      qc.setQueryData(qk.myAgency, a);
      qc.invalidateQueries({ queryKey: qk.me });
      toast.success(t('common.saved'));
    },
    onError: (e) => (e as Error).message !== 'validation' && toast.error(e),
  });

  const pickLogo = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
    if (r.canceled) return;
    setUploading(true);
    try {
      const img = await ImageManipulator.manipulate(r.assets[0].uri).resize({ width: 512 }).renderAsync();
      const saved = await img.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
      const up = await uploadFile({ uri: saved.uri, name: 'logo.jpg', type: 'image/jpeg' });
      set('logoUrl')(up.url);
    } catch (e) {
      toast.error(e);
    } finally {
      setUploading(false);
    }
  };

  if (q.isLoading) return <Loading />;
  // 404 = no agency yet → show the create form.
  if (q.isError && !isNotFound(q.error)) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
        {!exists && <Text muted>{t('agency.createHint')}</Text>}
        {exists && q.data && <StatusPill label={q.data.verified ? t('agency.verified') : t('agency.notVerified')} tone={q.data.verified ? 'success' : 'warning'} />}
        <Pressable onPress={pickLogo} accessibilityRole="button" accessibilityLabel={t('agency.logo')} style={{ alignItems: 'center', gap: spacing.sm }}>
          <Avatar uri={f.logoUrl} name={f.name || 'A'} size={88} />
          <Text color={c.primary} style={{ fontWeight: '600' }}>
            {uploading ? t('common.loading') : t('agency.logo')}
          </Text>
        </Pressable>
        <Field label={t('agency.name')} value={f.name} onChangeText={set('name')} error={errors.name} />
        <View style={{ gap: 6 }}>
          <Text variant="label">{t('agency.type')}</Text>
          <Segmented
            options={[
              { value: 'AGENCY', label: te('agencyType', 'AGENCY') },
              { value: 'DEVELOPER', label: te('agencyType', 'DEVELOPER') },
            ]}
            value={f.type}
            onChange={set('type')}
          />
        </View>
        <Select label={t('agency.city')} options={CITIES.map((x) => ({ value: x.id, label: ln(x.name) }))} value={f.cityId} onChange={set('cityId')} />
        <Field label={t('agency.address')} value={f.address} onChangeText={set('address')} error={errors.address} />
        <Field
          label={t('agency.phone')}
          value={formatLocalPhone(f.phone)}
          onChangeText={(v) => set('phone')(v.replace(/\D/g, '').replace(/^0/, '').slice(0, 9))}
          keyboardType="phone-pad"
          left={<Text style={{ fontWeight: '600' }}>+994</Text>}
          error={errors.phone}
        />
        <Field label={t('agency.email')} value={f.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" error={errors.email} />
        <Field label={t('agency.website')} value={f.website} onChangeText={set('website')} keyboardType="url" autoCapitalize="none" placeholder="https://" error={errors.website} />
        <Field label={t('agency.description')} value={f.description} onChangeText={set('description')} multiline maxLength={5000} error={errors.description} />
        <Button title={exists ? t('common.save') : t('agency.create')} loading={save.isPending} onPress={() => save.mutate()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
