import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState } from '@/src/components/EmptyState';
import { PriceText } from '@/src/components/PriceText';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { Segmented } from '@/src/components/Segmented';
import { Heatmap, type Cell } from '@/src/charts/Heatmap';
import { BUCKETS, bucketColor, colorForCorr, type Poles } from '@/src/charts/heatmapColor';
import { formatDate, formatRatio } from '@/src/data/format';
import { getCorrelation, getMeta, getStock } from '@/src/data/store';
import { useSettings } from '@/src/state/SettingsContext';
import { tick } from '@/src/theme/haptics';
import { layout, space, typo, type Theme } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { CorrelationCluster, RankMode } from '@/shared/types';

const MODES: { value: RankMode; label: string }[] = [
  { value: 'blended', label: 'Momentum' },
  { value: 'volAdj', label: 'Vol-adjusted' },
];

export function CorrelationScreen() {
  const theme = useTheme();
  const s = styles(theme);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { settings, update } = useSettings();
  const mode = settings.rankMode;
  const meta = getMeta();
  const set = getCorrelation(mode);

  const [selected, setSelected] = useState<Cell | null>(null);
  const [focusedId, setFocusedId] = useState<number | null>(null);

  const poles: Poles = useMemo(
    () => ({
      positive: theme.colors.corrPositive,
      negative: theme.colors.corrNegative,
      neutral: theme.colors.corrNeutral,
    }),
    [theme],
  );

  const matrixSize = width - layout.gutter * 2;
  const focused = set?.clusters.find((c) => c.id === focusedId) ?? null;

  const switchMode = (next: RankMode) => {
    setSelected(null);
    setFocusedId(null);
    update({ rankMode: next });
  };

  const toggleFocus = (cluster: CorrelationCluster) => {
    tick();
    setFocusedId((cur) => (cur === cluster.id ? null : cluster.id));
    setSelected(null);
  };

  const openTicker = (symbol: string, cluster: CorrelationCluster) => {
    router.push({
      pathname: '/ticker/[symbol]',
      params: { symbol, list: `cluster:${mode}:${cluster.id}` },
    });
  };

  if (!set || set.tickers.length < 2) {
    return (
      <View style={[s.screen, { paddingTop: insets.top }]}>
        <Back onPress={() => router.back()} />
        <EmptyState
          icon="grid-outline"
          title="No correlation data"
          hint="Ask Claude Code to refresh the data."
        />
      </View>
    );
  }

  const pair =
    selected !== null
      ? { a: set.tickers[selected.row], b: set.tickers[selected.col], r: set.matrix[selected.row][selected.col] }
      : null;

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <Back onPress={() => router.back()} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space.s24 }}>
        <ScreenHeader
          title="Correlation"
          subtitle={`Top ${set.tickers.length} · ${meta.source === 'mock' ? 'mock · ' : ''}126-day window · as of ${formatDate(meta.asOf)}`}
        />
        <View style={s.segmentWrap}>
          <Segmented options={MODES} value={mode} onChange={switchMode} />
        </View>

        {/* Readout sits above the matrix so it never jumps under your finger. */}
        <View style={s.readout}>
          {pair ? (
            <>
              <View style={s.readoutHead}>
                <View style={[s.swatch, { backgroundColor: colorForCorr(pair.r, poles) }]} />
                <Text style={s.readoutPair} numberOfLines={1}>
                  {pair.a} × {pair.b}
                </Text>
                <PriceText style={s.readoutValue}>ρ {formatRatio(pair.r)}</PriceText>
              </View>
              <Text style={s.readoutNames} numberOfLines={1}>
                {pair.a === pair.b
                  ? (getStock(pair.a)?.name ?? pair.a)
                  : `${getStock(pair.a)?.name ?? pair.a} · ${getStock(pair.b)?.name ?? pair.b}`}
              </Text>
            </>
          ) : (
            <>
              <Text style={s.readoutPair}>Tap or drag the grid</Text>
              <Text style={s.readoutNames}>
                Bright blocks on the diagonal are stocks that moved together.
              </Text>
            </>
          )}
        </View>

        <View style={{ paddingHorizontal: layout.gutter }}>
          <Heatmap
            set={set}
            size={matrixSize}
            focused={focused}
            selected={selected}
            onSelect={setSelected}
          />
        </View>

        <Legend poles={poles} />

        <Text style={s.sectionTitle}>GROUPS</Text>
        {set.clusters.map((cluster) => {
          const isFocused = cluster.id === focusedId;
          const members = set.tickers.slice(cluster.start, cluster.start + cluster.size);
          return (
            <View key={cluster.id} style={[s.card, isFocused && s.cardFocused]}>
              <Pressable style={s.cardHead} onPress={() => toggleFocus(cluster)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle}>
                    {cluster.topSector} ({cluster.size})
                  </Text>
                  <PriceText style={s.cardMeta}>
                    avg ρ {formatRatio(cluster.avgIntraCorr)}
                  </PriceText>
                </View>
                <Ionicons
                  name={isFocused ? 'eye' : 'eye-outline'}
                  size={17}
                  color={isFocused ? theme.colors.text : theme.colors.textTertiary}
                />
              </Pressable>
              <View style={s.chips}>
                {members.map((symbol) => (
                  <Pressable
                    key={symbol}
                    style={s.chip}
                    onPress={() => openTicker(symbol, cluster)}
                  >
                    <Text style={s.chipText}>{symbol}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Back({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={12} style={{ padding: space.s8, alignSelf: 'flex-start' }}>
      <Ionicons name="chevron-back" size={24} color={theme.colors.text} />
    </Pressable>
  );
}

/** Colour scale legend — a colour-encoded chart always ships one. */
function Legend({ poles }: { poles: Poles }) {
  const theme = useTheme();
  const s = styles(theme);
  return (
    <View style={s.legend}>
      <View style={s.legendStrip}>
        {Array.from({ length: BUCKETS }, (_, b) => (
          <View key={b} style={{ flex: 1, height: 8, backgroundColor: bucketColor(b, poles) }} />
        ))}
      </View>
      <View style={s.legendLabels}>
        <PriceText style={s.legendLabel}>−1 opposite</PriceText>
        <PriceText style={s.legendLabel}>0</PriceText>
        <PriceText style={s.legendLabel}>+1 together</PriceText>
      </View>
    </View>
  );
}

const styles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    segmentWrap: { paddingHorizontal: layout.gutter, paddingBottom: space.s12 },
    readout: { paddingHorizontal: layout.gutter, paddingBottom: space.s12, minHeight: 52 },
    readoutHead: { flexDirection: 'row', alignItems: 'center' },
    swatch: { width: 10, height: 10, borderRadius: 2, marginRight: space.s8 },
    readoutPair: { ...typo.body, fontWeight: '600', color: theme.colors.text, flex: 1 },
    readoutValue: { ...typo.body, fontWeight: '600', color: theme.colors.text },
    readoutNames: { ...typo.caption, color: theme.colors.textSecondary, marginTop: 2 },
    legend: { paddingHorizontal: layout.gutter, marginTop: space.s12 },
    legendStrip: { flexDirection: 'row', borderRadius: 3, overflow: 'hidden' },
    legendLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.s4 },
    legendLabel: { ...typo.micro, color: theme.colors.textTertiary },
    sectionTitle: {
      ...typo.micro,
      letterSpacing: 0.8,
      color: theme.colors.textTertiary,
      marginTop: space.s24,
      marginBottom: space.s8,
      marginHorizontal: layout.gutter,
    },
    card: {
      marginHorizontal: layout.gutter,
      marginBottom: space.s8,
      backgroundColor: theme.colors.bgElevated,
      borderRadius: layout.radius,
      overflow: 'hidden',
    },
    cardFocused: { backgroundColor: theme.colors.fillSubtle },
    cardHead: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: space.s12,
      paddingTop: space.s12,
      paddingBottom: space.s8,
    },
    cardTitle: { ...typo.body, fontWeight: '600', color: theme.colors.text },
    cardMeta: { ...typo.caption, color: theme.colors.textSecondary, marginTop: 1 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: space.s8, paddingBottom: space.s12 },
    chip: {
      paddingHorizontal: space.s8,
      paddingVertical: 5,
      margin: space.s4,
      borderRadius: layout.radiusSmall,
      backgroundColor: theme.colors.fillSubtle,
    },
    chipText: { ...typo.caption, fontWeight: '600', color: theme.colors.text },
  });
