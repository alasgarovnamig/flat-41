import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, radius, spacing, font } from '../theme';
import { useI18n } from '../i18n';
import { errorMessage } from '../lib/errors';

type Kind = 'success' | 'error' | 'info';
type Toast = { id: number; text: string; kind: Kind };
type Ctx = { show: (text: string, kind?: Kind) => void; error: (e: unknown) => void; success: (text: string) => void };

const ToastCtx = createContext<Ctx>({ show: () => {}, error: () => {}, success: () => {} });

/** Snackbar-style toast at the top of the screen. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<Toast | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setToast(null));
  }, [anim]);

  const show = useCallback(
    (text: string, kind: Kind = 'info') => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ id: Date.now(), text, kind });
      anim.setValue(0);
      Animated.spring(anim, { toValue: 1, useNativeDriver: true }).start();
      timer.current = setTimeout(hide, kind === 'error' ? 4000 : 2500);
    },
    [anim, hide],
  );

  const value = useMemo<Ctx>(
    () => ({ show, error: (e) => show(errorMessage(e, t), 'error'), success: (text) => show(text, 'success') }),
    [show, t],
  );

  const bg = toast?.kind === 'error' ? c.danger : toast?.kind === 'success' ? c.primary : '#1F2937';
  const icon = toast?.kind === 'error' ? 'alert-circle' : toast?.kind === 'success' ? 'checkmark-circle' : 'information-circle';

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {toast && (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.wrap,
            { top: insets.top + spacing.sm, opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) }] },
          ]}
        >
          <Pressable onPress={hide} accessibilityRole="alert" style={[styles.toast, { backgroundColor: bg }]}>
            <Ionicons name={icon} size={20} color="#fff" />
            <View style={{ flex: 1 }}>
              <Text style={styles.text}>{toast.text}</Text>
            </View>
          </Pressable>
        </Animated.View>
      )}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.lg, right: spacing.lg, zIndex: 1000, elevation: 20 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  text: { color: '#fff', fontSize: font.md, fontWeight: '500' },
});
