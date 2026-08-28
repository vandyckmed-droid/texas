import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '@/src/components/EmptyState';
import { useTheme } from '@/src/theme/useTheme';

/** Placeholder — the correlation matrix and cluster groups land in Phase 5. */
export default function CorrelationRoute() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg, paddingTop: insets.top }}>
      <Pressable onPress={() => router.back()} hitSlop={12} style={{ padding: 16 }}>
        <Text style={{ color: theme.colors.textSecondary }}>‹ Back</Text>
      </Pressable>
      <EmptyState icon="grid-outline" title="Correlation" hint="Arrives in Phase 5." />
    </View>
  );
}
