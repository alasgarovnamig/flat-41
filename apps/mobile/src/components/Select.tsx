import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Sheet } from './Sheet';
import { Button, Field, Text } from './ui';
import { useI18n } from '../i18n';
import { HIT, radius, spacing, useTheme } from '../theme';

export type Option = { value: string; label: string; hint?: string; color?: string };

type Common = { label: string; options: Option[]; placeholder?: string; disabled?: boolean; error?: string; searchable?: boolean };
type Single = Common & { multiple?: false; value: string | null | undefined; onChange: (v: string | null) => void; clearable?: boolean };
type Multi = Common & { multiple: true; value: string[]; onChange: (v: string[]) => void };

/** Field that opens a bottom sheet with (optionally searchable) options. */
export function Select(props: Single | Multi) {
  const { c } = useTheme();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<string[]>([]);

  const selectedLabels = props.multiple
    ? props.options.filter((o) => props.value.includes(o.value)).map((o) => o.label)
    : props.options.filter((o) => o.value === props.value).map((o) => o.label);
  const display = props.multiple && selectedLabels.length > 2 ? t('search.selected', { n: selectedLabels.length }) : selectedLabels.join(', ');

  const filtered = useMemo(
    () => (q ? props.options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : props.options),
    [q, props.options],
  );
  const searchable = props.searchable ?? props.options.length > 10;

  const openSheet = () => {
    if (props.disabled) return;
    setQ('');
    if (props.multiple) setDraft(props.value);
    setOpen(true);
  };

  return (
    <View style={{ gap: 6 }}>
      <Text variant="label">{props.label}</Text>
      <Pressable
        onPress={openSheet}
        accessibilityRole="button"
        accessibilityLabel={`${props.label}: ${display || props.placeholder || t('common.select')}`}
        style={[styles.field, { backgroundColor: c.inputBg, borderColor: props.error ? c.danger : c.border, opacity: props.disabled ? 0.5 : 1 }]}
      >
        <Text style={{ flex: 1 }} muted={!display} numberOfLines={1}>
          {display || props.placeholder || t('common.select')}
        </Text>
        <Ionicons name="chevron-down" size={18} color={c.muted} />
      </Pressable>
      {!!props.error && <Text variant="small" color={c.danger}>{props.error}</Text>}

      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title={props.label}
        footer={
          props.multiple ? (
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button title={t('common.clear')} kind="outline" style={{ flex: 1 }} onPress={() => setDraft([])} />
              <Button
                title={t('common.apply')}
                style={{ flex: 2 }}
                onPress={() => {
                  props.onChange(draft);
                  setOpen(false);
                }}
              />
            </View>
          ) : undefined
        }
      >
        {searchable && <Field value={q} onChangeText={setQ} placeholder={t('common.search')} left={<Ionicons name="search" size={18} color={c.muted} />} autoCorrect={false} />}
        {!props.multiple && props.clearable && (
          <OptionRow
            label={props.placeholder ?? t('common.any')}
            selected={!props.value}
            onPress={() => {
              props.onChange(null);
              setOpen(false);
            }}
          />
        )}
        {filtered.map((o) => {
          const selected = props.multiple ? draft.includes(o.value) : props.value === o.value;
          return (
            <OptionRow
              key={o.value}
              label={o.label}
              hint={o.hint}
              color={o.color}
              selected={selected}
              multiple={props.multiple}
              onPress={() => {
                if (props.multiple) setDraft((d) => (d.includes(o.value) ? d.filter((x) => x !== o.value) : [...d, o.value]));
                else {
                  props.onChange(o.value);
                  setOpen(false);
                }
              }}
            />
          );
        })}
      </Sheet>
    </View>
  );
}

function OptionRow({ label, hint, selected, onPress, multiple, color }: { label: string; hint?: string; selected: boolean; onPress: () => void; multiple?: boolean; color?: string }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole={multiple ? 'checkbox' : 'radio'} accessibilityState={{ checked: selected }} style={[styles.option, { borderBottomColor: c.border }]}>
      {color && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />}
      <View style={{ flex: 1 }}>
        <Text style={selected ? { fontWeight: '700', color: c.primary } : undefined}>{label}</Text>
        {hint && <Text variant="small" muted>{hint}</Text>}
      </View>
      <Ionicons
        name={multiple ? (selected ? 'checkbox' : 'square-outline') : selected ? 'radio-button-on' : 'radio-button-off'}
        size={22}
        color={selected ? c.primary : c.muted}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { minHeight: 48, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: HIT + 4, borderBottomWidth: StyleSheet.hairlineWidth },
});
