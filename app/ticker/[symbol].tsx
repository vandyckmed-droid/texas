import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '@/src/components/EmptyState';
import { useTheme } from '@/src/theme/useTheme';

/** Placeholder — the full ticker view (charts, crosshair, prev/next) lands in Phase 4. */
export default function TickerRoute() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg, paddingTop: insets.top }}>
      <Pressable onPress={() => router.back()} hitSlop={12} style={{ padding: 16 }}>
        <Text style={{ color: theme.colors.textSecondary }}>‹ Back</Text>
      </Pressable>
      <EmptyState icon="analytics-outline" title={symbol ?? ''} hint="Ticker view arrives in Phase 4." />
    </View>
  );
}
