import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, spacing, useTheme } from '../theme';
import { IconButton, Text } from './ui';
import { useI18n } from '../i18n';

/** Bottom sheet built on RN Modal (no extra native deps). */
export function Sheet({
  visible, onClose, title, children, footer, scroll = true, maxHeight = '88%',
}: {
  visible: boolean; onClose: () => void; title?: string; children: ReactNode; footer?: ReactNode; scroll?: boolean; maxHeight?: `${number}%`;
}) {
  const { c } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay }]} onPress={onClose} accessibilityLabel={t('common.close')} />
        <View style={[styles.sheet, { backgroundColor: c.bg, maxHeight, paddingBottom: footer ? 0 : insets.bottom + spacing.md }]}>
          <View style={[styles.handle, { backgroundColor: c.border }]} />
          {title !== undefined && (
            <View style={styles.header}>
              <Text variant="h3" style={{ flex: 1 }} accessibilityRole="header">
                {title}
              </Text>
              <IconButton name="close" label={t('common.close')} onPress={onClose} />
            </View>
          )}
          {scroll ? (
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          ) : (
            <View style={styles.body}>{children}</View>
          )}
          {footer && <View style={[styles.footer, { borderTopColor: c.border, paddingBottom: insets.bottom + spacing.md }]}>{footer}</View>}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Simple action sheet (cross-platform). */
export function ActionSheet({
  visible, onClose, title, actions,
}: {
  visible: boolean; onClose: () => void; title?: string;
  actions: { label: string; onPress: () => void; danger?: boolean; icon?: Parameters<typeof IconButton>[0]['name'] }[];
}) {
  const { c } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {actions.map((a) => (
        <Pressable
          key={a.label}
          accessibilityRole="button"
          onPress={() => {
            onClose();
            setTimeout(a.onPress, 250);
          }}
          style={({ pressed }) => [styles.action, { borderBottomColor: c.border }, pressed && { backgroundColor: c.surface }]}
        >
          <Text color={a.danger ? c.danger : c.text} style={{ fontSize: 16 }}>
            {a.label}
          </Text>
        </Pressable>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: radius.lg + 4, borderTopRightRadius: radius.lg + 4 },
  handle: { width: 40, height: 5, borderRadius: 3, alignSelf: 'center', marginTop: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.lg, paddingRight: spacing.xs },
  body: { padding: spacing.lg, gap: spacing.md },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  action: { minHeight: 52, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
});
