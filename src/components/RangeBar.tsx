import React from 'react';
import { View } from 'react-native';
import { useTheme } from '@/src/theme/useTheme';

const WIDTH = 72;
const MARKER = 7;

/**
 * 52-week range: a subtle track from low to high with a dot at the latest
 * price's position. Plain Views — cheap enough for every list row.
 */
export function RangeBar({ low, high, latest }: { low: number; high: number; latest: number }) {
  const { colors } = useTheme();
  const span = high - low;
  const pos = span > 0 ? Math.min(1, Math.max(0, (latest - low) / span)) : 0.5;
  return (
    <View style={{ width: WIDTH, height: MARKER, justifyContent: 'center' }}>
      <View style={{ height: 3, borderRadius: 1.5, backgroundColor: colors.fillSubtle }} />
      <View
        style={{
          position: 'absolute',
          left: pos * (WIDTH - MARKER),
          width: MARKER,
          height: MARKER,
          borderRadius: MARKER / 2,
          backgroundColor: colors.textSecondary,
        }}
      />
    </View>
  );
}
