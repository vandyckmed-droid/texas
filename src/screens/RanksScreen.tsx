import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '@/src/components/EmptyState';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { Segmented } from '@/src/components/Segmented';
import { StockRow } from '@/src/components/StockRow';
import { formatDate } from '@/src/data/format';
import { getMeta, getTop50, rankOf } from '@/src/data/store';
import { useSettings } from '@/src/state/SettingsContext';
import { layout, space, type Theme } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { RankMode, StockRow as Row } from '@/shared/types';

const MODES: { value: RankMode; label: string }[] = [
  { value: 'blended', label: 'Momentum' },
  { value: 'volAdj', label: 'Vol-adjusted' },
];

export function RanksScreen() {
  const theme = useTheme();
  const s = styles(theme);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { settings, update } = useSettings();
  const mode = settings.rankMode;
  const meta = getMeta();
  const data = getTop50(mode);

  const renderItem = useCallback(
    ({ item }: { item: Row }) => (
      <StockRow
        stock={item}
        rank={rankOf(item, mode)}
        mode={mode}
        viz={settings.rowViz}
        onPress={() =>
          router.push({
            pathname: '/ticker/[symbol]',
            params: { symbol: item.symbol, list: `ranks:${mode}` },
          })
        }
      />
    ),
    [mode, settings.rowViz, router],
  );

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Ranks"
        subtitle={`Top 50 of ${meta.rankedCount} · as of ${formatDate(meta.asOf)}${meta.source === 'mock' ? ' · mock data' : ''}`}
        right={
          <Pressable
            onPress={() => router.push('/correlation')}
            hitSlop={10}
            style={s.headerButton}
            accessibilityLabel="Correlation and groups"
          >
            <Ionicons name="grid-outline" size={21} color={theme.colors.textSecondary} />
          </Pressable>
        }
      />
      <View style={s.segmentWrap}>
        <Segmented options={MODES} value={mode} onChange={(rankMode) => update({ rankMode })} />
      </View>
      <FlatList
        data={data}
        keyExtractor={(item) => item.symbol}
        renderItem={renderItem}
        getItemLayout={(_, index) => ({
          length: layout.rowHeight,
          offset: layout.rowHeight * index,
          index,
        })}
        ListEmptyComponent={<EmptyState icon="podium-outline" title="No ranking data" />}
        contentContainerStyle={{ paddingBottom: space.s16 }}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    headerButton: { paddingBottom: 4, paddingLeft: space.s12 },
    segmentWrap: { paddingHorizontal: layout.gutter, paddingBottom: space.s8 },
  });
