import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInLeft, FadeInRight } from 'react-native-reanimated';
import { EmptyState } from '@/src/components/EmptyState';
import { PriceText } from '@/src/components/PriceText';
import { Segmented } from '@/src/components/Segmented';
import { WatchStar } from '@/src/components/WatchStar';
import { PriceChart, type ChartKind } from '@/src/charts/PriceChart';
import { windowBars, type WindowKey } from '@/src/charts/scales';
import { formatDayLong, formatPct, formatPrice, formatRatio } from '@/src/data/format';
import { getChart, getCorrelation, getStock, getTop50, rankOf } from '@/src/data/store';
import { useSettings } from '@/src/state/SettingsContext';
import { useWatchlist } from '@/src/state/WatchlistContext';
import { tap } from '@/src/theme/haptics';
import { layout, space, typo, type Theme } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { RankMode } from '@/shared/types';

const WINDOW_OPTIONS: { value: WindowKey; label: string }[] = [
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: '12M', label: '12M' },
];

const KIND_OPTIONS: { value: ChartKind; label: string }[] = [
  { value: 'line', label: 'Line' },
  { value: 'candle', label: 'Candles' },
];

/** Resolves the ordered symbol list the ticker view navigates through. */
function orderedSymbols(list: string | undefined, watchlist: string[], rankMode: RankMode): string[] {
  if (!list) return [];
  if (list === 'watchlist') {
    return watchlist
      .map((sym) => getStock(sym))
      .filter((s): s is NonNullable<typeof s> => s !== undefined)
      .sort((a, b) => rankOf(a, rankMode) - rankOf(b, rankMode))
      .map((s) => s.symbol);
  }
  if (list.startsWith('ranks:')) {
    return getTop50(list.slice(6) as RankMode).map((s) => s.symbol);
  }
  if (list.startsWith('solo:')) {
    const set = getCorrelation(list.slice(5) as RankMode);
    if (set) return set.clusters.filter((cl) => cl.size === 1).map((cl) => set.tickers[cl.start]);
  }
  if (list.startsWith('cluster:')) {
    const [, mode, idStr] = list.split(':');
    const set = getCorrelation(mode as RankMode);
    const cluster = set?.clusters.find((cl) => cl.id === Number(idStr));
    if (set && cluster) return set.tickers.slice(cluster.start, cluster.start + cluster.size);
  }
  return [];
}

export function TickerScreen() {
  const { symbol, list } = useLocalSearchParams<{ symbol: string; list?: string }>();
  const theme = useTheme();
  const s = styles(theme);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { settings } = useSettings();
  const { symbols: watchSymbols } = useWatchlist();

  const [win, setWin] = useState<WindowKey>('6M');
  const [kind, setKind] = useState<ChartKind>('line');
  const [readoutIdx, setReadoutIdx] = useState<number | null>(null);
  const direction = useRef(1);

  const stock = symbol ? getStock(symbol) : undefined;
  const chart = symbol ? getChart(symbol) : null;

  // Snapshot on entry: the list param and rank mode are fixed for a pushed
  // screen, and prev/next swaps symbols via setParams without remounting, so
  // this stays the list the user arrived with — unstarring the symbol you are
  // viewing must not empty out its own navigation.
  const [nav] = useState(() => orderedSymbols(list, watchSymbols, settings.rankMode));
  const navIndex = symbol ? nav.indexOf(symbol) : -1;

  const go = (dir: 1 | -1) => {
    const next = nav[navIndex + dir];
    if (!next) return;
    tap();
    direction.current = dir;
    setReadoutIdx(null);
    router.setParams({ symbol: next });
  };

  if (!stock || !chart) {
    return (
      <View style={[s.screen, { paddingTop: insets.top }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.backButton}>
          <Ionicons name="chevron-back" size={24} color={theme.colors.text} />
        </Pressable>
        <EmptyState icon="help-circle-outline" title={symbol ?? 'Unknown'} hint="No data for this symbol in the current snapshot." />
      </View>
    );
  }

  // Values for the active window slice.
  const n = windowBars(win, chart.c.length);
  const offset = chart.c.length - n;
  const windowFirst = chart.c[offset];
  // A window change re-renders before PriceChart's reset effect clears the
  // crosshair, so an index from a longer window can outlive its slice.
  const idx = readoutIdx !== null && readoutIdx < n ? readoutIdx : null;
  const shownClose = idx === null ? stock.price : chart.c[offset + idx];
  const delta = shownClose - windowFirst;
  const deltaPct = windowFirst !== 0 ? delta / windowFirst : 0;
  const deltaColor = delta >= 0 ? theme.colors.positive : theme.colors.negative;
  const chartHeight = 290;

  const readoutLine =
    idx === null
      ? `${delta >= 0 ? '+' : '−'}${formatPrice(Math.abs(delta))} (${formatPct(deltaPct)}) · ${win}`
      : kind === 'candle'
        ? `${formatDayLong(chart.t[offset + idx])} · O ${formatPrice(chart.o[offset + idx])}  H ${formatPrice(chart.h[offset + idx])}  L ${formatPrice(chart.l[offset + idx])}`
        : `${formatDayLong(chart.t[offset + idx])} · ${delta >= 0 ? '+' : '−'}${formatPrice(Math.abs(delta))} (${formatPct(deltaPct)})`;

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.backButton}>
          <Ionicons name="chevron-back" size={24} color={theme.colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.symbol}>{stock.symbol}</Text>
          <Text style={s.name} numberOfLines={1}>
            {stock.name}
          </Text>
        </View>
        <WatchStar symbol={stock.symbol} size={20} />
        {nav.length > 1 && (
          <View style={s.navGroup}>
            <Pressable
              onPress={() => go(-1)}
              disabled={navIndex <= 0}
              hitSlop={8}
              style={[s.navButton, navIndex <= 0 && s.navDisabled]}
            >
              <Ionicons name="chevron-back" size={19} color={theme.colors.textSecondary} />
            </Pressable>
            <PriceText style={s.navText}>
              {navIndex + 1}/{nav.length}
            </PriceText>
            <Pressable
              onPress={() => go(1)}
              disabled={navIndex < 0 || navIndex >= nav.length - 1}
              hitSlop={8}
              style={[s.navButton, (navIndex < 0 || navIndex >= nav.length - 1) && s.navDisabled]}
            >
              <Ionicons name="chevron-forward" size={19} color={theme.colors.textSecondary} />
            </Pressable>
          </View>
        )}
      </View>

      <Animated.View
        key={stock.symbol}
        entering={(direction.current >= 0 ? FadeInRight : FadeInLeft).duration(200)}
        style={{ flex: 1 }}
      >
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space.s24 }}>
          <View style={s.priceBlock}>
            <PriceText style={s.bigPrice}>{formatPrice(shownClose)}</PriceText>
            <PriceText style={[s.readout, { color: idx === null || kind === 'line' ? deltaColor : theme.colors.textSecondary }]}>
              {readoutLine}
            </PriceText>
          </View>

          <PriceChart
            chart={chart}
            window={win}
            kind={kind}
            width={width}
            height={chartHeight}
            onReadout={setReadoutIdx}
          />

          <View style={s.controls}>
            <View style={{ flex: 1 }}>
              <Segmented options={WINDOW_OPTIONS} value={win} onChange={setWin} compact />
            </View>
            <View style={{ width: 132, marginLeft: space.s8 }}>
              <Segmented options={KIND_OPTIONS} value={kind} onChange={setKind} compact />
            </View>
          </View>

          <View style={s.statGrid}>
            {statCell(s, 'Blended momentum', formatPct(stock.blended), stock.blended >= 0 ? theme.colors.positive : theme.colors.negative)}
            {statCell(s, 'Vol-adjusted', formatRatio(stock.volAdj), stock.volAdj >= 0 ? theme.colors.positive : theme.colors.negative)}
            {statCell(s, '12–1 momentum', formatPct(stock.m12))}
            {statCell(s, '6–1 momentum', formatPct(stock.m6))}
            {statCell(s, 'Volatility (126d)', `${(stock.vol * 100).toFixed(1)}%`)}
            {statCell(s, '52-week range', `${formatPrice(stock.wk52Low)} – ${formatPrice(stock.wk52High)}`)}
            {statCell(s, 'Rank · momentum', `#${stock.rankBlended}`)}
            {statCell(s, 'Rank · vol-adjusted', `#${stock.rankVolAdj}`)}
            {statCell(s, 'Sector', stock.sector)}
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

function statCell(s: ReturnType<typeof styles>, label: string, value: string, color?: string) {
  return (
    <View style={s.statCell} key={label}>
      <Text style={s.statLabel}>{label}</Text>
      <PriceText style={[s.statValue, color ? { color } : null]} numberOfLines={1}>
        {value}
      </PriceText>
    </View>
  );
}

const styles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: space.s8,
      paddingVertical: space.s4,
    },
    backButton: { padding: space.s8 },
    symbol: { ...typo.title, color: theme.colors.text },
    name: { ...typo.caption, color: theme.colors.textSecondary, marginTop: 1 },
    navGroup: { flexDirection: 'row', alignItems: 'center', marginLeft: space.s4 },
    navButton: {
      width: 36,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    navDisabled: { opacity: 0.3 },
    navText: { ...typo.micro, color: theme.colors.textTertiary },
    priceBlock: { paddingHorizontal: layout.gutter, paddingTop: space.s8, paddingBottom: space.s12 },
    bigPrice: { fontSize: 32, fontWeight: '700', color: theme.colors.text, letterSpacing: 0.2 },
    readout: { ...typo.rowMeta, fontWeight: '500', marginTop: 3 },
    controls: {
      flexDirection: 'row',
      paddingHorizontal: layout.gutter,
      marginTop: space.s12,
    },
    statGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: layout.gutter,
      marginTop: space.s20,
    },
    statCell: { width: '50%', paddingVertical: space.s8, paddingRight: space.s8 },
    statLabel: { ...typo.caption, color: theme.colors.textTertiary },
    statValue: { ...typo.body, fontSize: 15, fontWeight: '500', color: theme.colors.text, marginTop: 2 },
  });
