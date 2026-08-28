import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatPct, formatPrice, formatRatio } from '@/src/data/format';
import { PriceText } from '@/src/components/PriceText';
import { RangeBar } from '@/src/components/RangeBar';
import { RollingBars } from '@/src/components/RollingBars';
import { WatchStar } from '@/src/components/WatchStar';
import { layout, type Theme, typo } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { RankMode, RowViz, StockRow as Row } from '@/shared/types';

interface Props {
  stock: Row;
  rank: number;
  mode: RankMode;
  viz: RowViz;
  onPress: () => void;
  dimmed?: boolean;
}

/**
 * One compact ranking row: rank · symbol/name · viz · price/score · star.
 * Fixed height so the list can use getItemLayout.
 */
export const StockRow = memo(function StockRow({ stock, rank, mode, viz, onPress, dimmed }: Props) {
  const theme = useTheme();
  const s = styles(theme);
  const score = mode === 'blended' ? formatPct(stock.blended) : formatRatio(stock.volAdj);
  const scorePositive = (mode === 'blended' ? stock.blended : stock.volAdj) >= 0;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && s.pressed, dimmed && s.dimmed]}
    >
      <PriceText style={s.rank}>{rank}</PriceText>
      <View style={s.nameCol}>
        <Text style={s.symbol}>{stock.symbol}</Text>
        <Text style={s.name} numberOfLines={1}>
          {stock.name}
        </Text>
      </View>
      <View style={s.viz}>
        {viz === 'range' ? (
          <RangeBar low={stock.wk52Low} high={stock.wk52High} latest={stock.price} />
        ) : (
          <RollingBars values={stock.rolling} />
        )}
      </View>
      <View style={s.priceCol}>
        <PriceText style={s.price}>{formatPrice(stock.price)}</PriceText>
        <PriceText style={[s.score, { color: scorePositive ? theme.colors.positive : theme.colors.negative }]}>
          {score}
        </PriceText>
      </View>
      <WatchStar symbol={stock.symbol} />
      <View style={s.separator} />
    </Pressable>
  );
});

const styles = (theme: Theme) =>
  StyleSheet.create({
    row: {
      height: layout.rowHeight,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: layout.gutter,
      paddingRight: layout.gutter - 8,
    },
    pressed: { backgroundColor: theme.colors.fillSubtle },
    dimmed: { opacity: 0.45 },
    rank: {
      width: 26,
      ...typo.rowMeta,
      color: theme.colors.textTertiary,
    },
    nameCol: { flex: 1, paddingRight: 8 },
    symbol: { ...typo.rowSymbol, color: theme.colors.text },
    name: { ...typo.rowMeta, color: theme.colors.textSecondary, marginTop: 1 },
    viz: { marginRight: 12 },
    priceCol: { alignItems: 'flex-end', minWidth: 74 },
    price: { ...typo.price, color: theme.colors.text },
    score: { ...typo.rowMeta, fontWeight: '500', marginTop: 1 },
    separator: {
      position: 'absolute',
      left: layout.gutter + 26,
      right: 0,
      bottom: 0,
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.separator,
    },
  });
