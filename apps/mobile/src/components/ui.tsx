/**
 * Small design-system primitives (brand colours, 12px rounded cards, 44pt touch targets, dark mode).
 */
import { forwardRef, useEffect, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator, Animated, Pressable, StyleSheet, Switch, Text as RNText, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { HIT, font, radius, spacing, useTheme } from '../theme';
import { absUrl } from '../config';
import { useI18n } from '../i18n';
import { errorMessage } from '../lib/errors';

export type IconName = keyof typeof Ionicons.glyphMap;

// ───────────── Text ─────────────
type Variant = 'h1' | 'h2' | 'h3' | 'body' | 'small' | 'caption' | 'label';
const variants: Record<Variant, TextStyle> = {
  h1: { fontSize: font.xxl, fontWeight: '700' },
  h2: { fontSize: font.xl, fontWeight: '700' },
  h3: { fontSize: font.lg, fontWeight: '600' },
  body: { fontSize: font.md },
  small: { fontSize: font.sm },
  caption: { fontSize: font.xs },
  label: { fontSize: font.sm, fontWeight: '600' },
};

export function Text({ variant = 'body', muted, color, style, ...rest }: TextProps & { variant?: Variant; muted?: boolean; color?: string }) {
  const { c } = useTheme();
  return <RNText {...rest} style={[{ color: color ?? (muted ? c.muted : c.text) }, variants[variant], style]} />;
}

// ───────────── Buttons ─────────────
type ButtonKind = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'vip' | 'premium';
export function Button({
  title, onPress, kind = 'primary', icon, loading, disabled, style, small, full = true, accessibilityLabel,
}: {
  title: string; onPress?: () => void; kind?: ButtonKind; icon?: IconName; loading?: boolean; disabled?: boolean;
  style?: StyleProp<ViewStyle>; small?: boolean; full?: boolean; accessibilityLabel?: string;
}) {
  const { c } = useTheme();
  const bg: Record<ButtonKind, string> = {
    primary: c.primary, secondary: c.primarySoft, outline: 'transparent', ghost: 'transparent', danger: c.danger, vip: c.vip, premium: c.premium,
  };
  const fg: Record<ButtonKind, string> = {
    primary: c.onPrimary, secondary: c.primary, outline: c.text, ghost: c.primary, danger: '#fff', vip: '#1F1300', premium: '#fff',
  };
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        !full && { alignSelf: 'flex-start' },
        { backgroundColor: bg[kind], opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1 },
        kind === 'outline' && { borderWidth: 1, borderColor: c.border },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg[kind]} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={small ? 16 : 18} color={fg[kind]} />}
          <RNText numberOfLines={1} style={[styles.btnText, small && { fontSize: font.sm }, { color: fg[kind] }]}>
            {title}
          </RNText>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  name, onPress, color, size = 22, label, style, bg, badge,
}: { name: IconName; onPress?: () => void; color?: string; size?: number; label: string; style?: StyleProp<ViewStyle>; bg?: string; badge?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [styles.iconBtn, bg ? { backgroundColor: bg } : null, { opacity: pressed ? 0.6 : 1 }, style]}
    >
      <Ionicons name={name} size={size} color={color ?? c.text} />
      {badge && <View style={[styles.dot, { backgroundColor: c.danger }]} />}
    </Pressable>
  );
}

// ───────────── Layout ─────────────
export function Card({ children, style, onPress, highlight }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; highlight?: boolean }) {
  const { c } = useTheme();
  const base = [styles.card, { backgroundColor: highlight ? c.highlightBg : c.card, borderColor: c.border }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [base, pressed && { opacity: 0.9 }]}>
      {children}
    </Pressable>
  );
}

export const Row = ({ children, style, gap = spacing.sm }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) => (
  <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>
);

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }, style]} />;
}

export function SectionHeader({ title, action, onAction, style }: { title: string; action?: string; onAction?: () => void; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View style={[styles.sectionHeader, style]}>
      <Text variant="h3" accessibilityRole="header">
        {title}
      </Text>
      {action && (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button">
          <RNText style={{ color: c.primary, fontWeight: '600' }}>{action}</RNText>
        </Pressable>
      )}
    </View>
  );
}

// ───────────── Chips / badges ─────────────
export function Chip({
  label, selected, onPress, icon, style, count,
}: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName; style?: StyleProp<ViewStyle>; count?: number }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? c.primary : c.surface, borderColor: selected ? c.primary : c.border, opacity: pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {icon && <Ionicons name={icon} size={16} color={selected ? c.onPrimary : c.text} />}
      <RNText style={{ color: selected ? c.onPrimary : c.text, fontSize: font.sm, fontWeight: '500' }}>{label}</RNText>
      {!!count && (
        <View style={[styles.chipCount, { backgroundColor: selected ? c.onPrimary : c.primary }]}>
          <RNText style={{ color: selected ? c.primary : c.onPrimary, fontSize: 11, fontWeight: '700' }}>{count}</RNText>
        </View>
      )}
    </Pressable>
  );
}

export function Badge({ label, color, textColor = '#fff', icon, style }: { label: string; color: string; textColor?: string; icon?: IconName; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.badge, { backgroundColor: color }, style]}>
      {icon && <Ionicons name={icon} size={11} color={textColor} />}
      <RNText style={{ color: textColor, fontSize: 11, fontWeight: '700' }}>{label}</RNText>
    </View>
  );
}

export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }) {
  const { c } = useTheme();
  const map = { success: c.success, warning: c.warning, danger: c.danger, neutral: c.muted, info: c.primary };
  return (
    <View style={[styles.pill, { borderColor: map[tone] }]}>
      <RNText style={{ color: map[tone], fontSize: 12, fontWeight: '600' }}>{label}</RNText>
    </View>
  );
}

// ───────────── Inputs ─────────────
type FieldProps = TextInputProps & { label?: string; error?: string; hint?: string; left?: ReactNode; right?: ReactNode; containerStyle?: StyleProp<ViewStyle> };
export const Field = forwardRef<TextInput, FieldProps>(function Field({ label, error, hint, left, right, containerStyle, style, multiline, ...rest }, ref) {
  const { c } = useTheme();
  return (
    <View style={[{ gap: 6 }, containerStyle]}>
      {label && <Text variant="label">{label}</Text>}
      <View style={[styles.input, { backgroundColor: c.inputBg, borderColor: error ? c.danger : c.border }, multiline && { alignItems: 'flex-start', minHeight: 110 }]}>
        {left}
        <TextInput
          ref={ref}
          placeholderTextColor={c.muted}
          multiline={multiline}
          accessibilityLabel={label}
          style={[{ flex: 1, color: c.text, fontSize: font.md, paddingVertical: 10 }, multiline && { textAlignVertical: 'top', minHeight: 100 }, style]}
          {...rest}
        />
        {right}
      </View>
      {!!error && <Text variant="small" color={c.danger}>{error}</Text>}
      {!error && !!hint && <Text variant="small" muted>{hint}</Text>}
    </View>
  );
});

export function SwitchRow({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: value }} style={styles.switchRow}>
      <View style={{ flex: 1 }}>
        <Text>{label}</Text>
        {hint && <Text variant="small" muted>{hint}</Text>}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: c.primary, false: c.border }} thumbColor="#fff" />
    </Pressable>
  );
}

export function Segmented<T extends string>({ options, value, onChange, style }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: c.surface, borderColor: c.border }, style]} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && { backgroundColor: c.card, shadowOpacity: 0.08 }]}
          >
            <RNText numberOfLines={1} style={{ color: active ? c.text : c.muted, fontWeight: active ? '700' : '500', fontSize: font.sm }}>
              {o.label}
            </RNText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stepper({ value, onChange, min = 0, max = 99, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label?: string }) {
  const { c } = useTheme();
  return (
    <View style={styles.stepper}>
      {label && <Text style={{ flex: 1 }}>{label}</Text>}
      <IconButton name="remove" label="-" onPress={() => onChange(Math.max(min, value - 1))} bg={c.surface} color={value <= min ? c.muted : c.text} />
      <Text variant="h3" style={{ minWidth: 32, textAlign: 'center' }} accessibilityLiveRegion="polite">
        {value}
      </Text>
      <IconButton name="add" label="+" onPress={() => onChange(Math.min(max, value + 1))} bg={c.surface} color={value >= max ? c.muted : c.text} />
    </View>
  );
}

export function ListItem({
  icon, title, subtitle, onPress, right, danger, badge, chevron = true,
}: { icon?: IconName; title: string; subtitle?: string; onPress?: () => void; right?: ReactNode; danger?: boolean; badge?: number; chevron?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.listItem, pressed && { backgroundColor: c.surface }]}>
      {icon && (
        <View style={[styles.listIcon, { backgroundColor: danger ? '#FDECEC' : c.primarySoft }]}>
          <Ionicons name={icon} size={18} color={danger ? c.danger : c.primary} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text color={danger ? c.danger : undefined}>{title}</Text>
        {subtitle && <Text variant="small" muted>{subtitle}</Text>}
      </View>
      {!!badge && <Badge label={badge > 99 ? '99+' : String(badge)} color={c.danger} />}
      {right}
      {chevron && onPress && <Ionicons name="chevron-forward" size={18} color={c.muted} />}
    </Pressable>
  );
}

export function Avatar({ uri, name, size = 44 }: { uri?: string | null; name?: string; size?: number }) {
  const { c } = useTheme();
  const initials = (name ?? '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  if (uri) return <Image source={{ uri: absUrl(uri) }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" accessibilityIgnoresInvertColors />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
      <RNText style={{ color: c.primary, fontWeight: '700', fontSize: size * 0.38 }}>{initials}</RNText>
    </View>
  );
}

// ───────────── States ─────────────
export function Skeleton({ width, height, style, round }: { width?: number | `${number}%`; height: number; style?: StyleProp<ViewStyle>; round?: boolean }) {
  const { c } = useTheme();
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[{ width: width ?? '100%', height, borderRadius: round ? height / 2 : radius.sm, backgroundColor: c.skeleton, opacity }, style]} />;
}

export function EmptyState({ icon = 'file-tray-outline', title, text, action, onAction }: { icon?: IconName; title: string; text?: string; action?: string; onAction?: () => void }) {
  const { c } = useTheme();
  return (
    <View style={styles.state}>
      <View style={[styles.stateIcon, { backgroundColor: c.primarySoft }]}>
        <Ionicons name={icon} size={34} color={c.primary} />
      </View>
      <Text variant="h3" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {text && (
        <Text muted style={{ textAlign: 'center' }}>
          {text}
        </Text>
      )}
      {action && <Button title={action} onPress={onAction} full={false} style={{ marginTop: spacing.sm }} />}
    </View>
  );
}

export function ErrorState({ error, onRetry, title }: { error?: unknown; onRetry?: () => void; title?: string }) {
  const { c } = useTheme();
  const { t } = useI18n();
  return (
    <View style={styles.state}>
      <View style={[styles.stateIcon, { backgroundColor: '#FDECEC' }]}>
        <Ionicons name="cloud-offline-outline" size={34} color={c.danger} />
      </View>
      <Text variant="h3" style={{ textAlign: 'center' }}>
        {title ?? t('common.errorTitle')}
      </Text>
      {error !== undefined && (
        <Text muted style={{ textAlign: 'center' }}>
          {errorMessage(error, t)}
        </Text>
      )}
      {onRetry && <Button title={t('common.retry')} icon="refresh" kind="outline" full={false} onPress={onRetry} style={{ marginTop: spacing.sm }} />}
    </View>
  );
}

export function Loading({ style }: { style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }, style]}>
      <ActivityIndicator color={c.primary} size="large" />
    </View>
  );
}

export function Pressy(props: PressableProps & { style?: StyleProp<ViewStyle> }) {
  const { style, ...rest } = props;
  return <Pressable {...rest} style={({ pressed }) => [style, pressed && { opacity: 0.85 }]} />;
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  btnSmall: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.sm },
  btnText: { fontSize: font.md, fontWeight: '600' },
  iconBtn: { minWidth: HIT, minHeight: HIT, borderRadius: HIT / 2, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 10, right: 10, width: 8, height: 8, borderRadius: 4 },
  card: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  chip: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipCount: { minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  pill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: HIT, paddingVertical: spacing.xs },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 3, borderWidth: StyleSheet.hairlineWidth },
  segment: {
    flex: 1,
    minHeight: 38,
    borderRadius: radius.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, minHeight: 56, paddingVertical: spacing.sm },
  listIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  state: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.sm, flexGrow: 1 },
  stateIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
});
