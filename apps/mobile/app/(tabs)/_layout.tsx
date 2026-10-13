import { Pressable, StyleSheet, View, type ColorValue } from 'react-native';
import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { qk } from '@/api/queryClient';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n';
import { brand, useTheme } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;
const icon = (active: IconName, inactive: IconName) =>
  function TabIcon({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) {
    return <Ionicons name={focused ? active : inactive} size={size} color={color as string} />;
  };

export default function TabsLayout() {
  const { c } = useTheme();
  const { t } = useI18n();
  const { isAuthed, requireAuth } = useAuth();
  const unread = useQuery({ queryKey: qk.unread, queryFn: api.unreadCount, enabled: isAuthed, refetchInterval: 60_000 });
  const unreadCount = unread.data?.count ?? 0;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.bg, borderTopColor: c.border },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '500' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarIcon: icon('home', 'home-outline') }} />
      <Tabs.Screen name="search" options={{ title: t('tabs.search'), tabBarIcon: icon('search', 'search-outline') }} />
      <Tabs.Screen
        name="add"
        options={{
          title: t('tabs.post'),
          tabBarAccessibilityLabel: t('tabs.post'),
          tabBarButton: (props) => (
            <Pressable
              onPress={() => requireAuth(() => router.push('/post'))}
              accessibilityRole="button"
              accessibilityLabel={t('tabs.post')}
              style={[props.style, styles.addWrap]}
            >
              <View style={[styles.add, { backgroundColor: brand.primary, borderColor: c.bg }]}>
                <Ionicons name="add" size={30} color="#fff" />
              </View>
            </Pressable>
          ),
        }}
        listeners={{ tabPress: (e) => e.preventDefault() }}
      />
      <Tabs.Screen name="favorites" options={{ title: t('tabs.favorites'), tabBarIcon: icon('heart', 'heart-outline') }} />
      <Tabs.Screen
        name="messages"
        options={{
          title: t('tabs.messages'),
          tabBarIcon: icon('chatbubbles', 'chatbubbles-outline'),
          tabBarBadge: unreadCount > 0 ? (unreadCount > 99 ? '99+' : unreadCount) : undefined,
          tabBarBadgeStyle: { backgroundColor: brand.urgent, fontSize: 10 },
        }}
      />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarIcon: icon('person', 'person-outline') }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  addWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  add: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -18,
    borderWidth: 4,
    shadowColor: brand.primary,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
