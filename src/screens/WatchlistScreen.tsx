import { useRouter } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '@/src/components/EmptyState';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { StockRow } from '@/src/components/StockRow';
import { WatchStar } from '@/src/components/WatchStar';
import { getStock, rankOf } from '@/src/data/store';
import { useSettings } from '@/src/state/SettingsContext';
import { useWatchlist } from '@/src/state/WatchlistContext';
import { layout } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { StockRow as Row } from '@/shared/types';

export function WatchlistScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { settings } = useSettings();
  const { symbols } = useWatchlist();
  const mode = settings.rankMode;

  // Watched stocks present in the snapshot, ordered by the active mode's rank;
  // symbols that left the universe are listed separately, dimmed, removable.
  const { rows, departed } = useMemo(() => {
    const present: Row[] = [];
    const gone: string[] = [];
    for (const sym of symbols) {
      const stock = getStock(sym);
      if (stock) present.push(stock);
      else gone.push(sym);
    }
    present.sort((a, b) => rankOf(a, mode) - rankOf(b, mode));
    return { rows: present, departed: gone.sort() };
  }, [symbols, mode]);

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
            params: { symbol: item.symbol, list: 'watchlist' },
          })
        }
      />
    ),
    [mode, settings.rowViz, router],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg, paddingTop: insets.top }}>
      <ScreenHeader
        title="Watchlist"
        subtitle={rows.length > 0 ? `${rows.length} ${rows.length === 1 ? 'stock' : 'stocks'}` : undefined}
      />
      <FlatList
        data={rows}
        keyExtractor={(item) => item.symbol}
        renderItem={renderItem}
        getItemLayout={(_, index) => ({
          length: layout.rowHeight,
          offset: layout.rowHeight * index,
          index,
        })}
        ListEmptyComponent={
          departed.length === 0 ? (
            <EmptyState
              icon="star-outline"
              title="Nothing watched yet"
              hint="Tap the star on any stock in Ranks to add it here."
            />
          ) : null
        }
        ListFooterComponent={departed.length > 0 ? <DepartedRows symbols={departed} /> : null}
        contentContainerStyle={rows.length === 0 && departed.length === 0 ? { flex: 1 } : undefined}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

/** Watched symbols missing from the current snapshot: dimmed, star removes. */
function DepartedRows({ symbols }: { symbols: string[] }) {
  const theme = useTheme();
  return (
    <View style={{ opacity: 0.5 }}>
      {symbols.map((sym) => (
        <View
          key={sym}
          style={{
            height: layout.rowHeight,
            flexDirection: 'row',
            alignItems: 'center',
            paddingLeft: layout.gutter + 26,
            paddingRight: layout.gutter - 8,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: theme.colors.text }}>{sym}</Text>
            <Text style={{ fontSize: 12.5, color: theme.colors.textSecondary, marginTop: 1 }}>
              Not in the current snapshot — tap the star to remove
            </Text>
          </View>
          <WatchStar symbol={sym} />
        </View>
      ))}
    </View>
  );
}
