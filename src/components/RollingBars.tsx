import React from 'react';
import { View } from 'react-native';
import { useTheme } from '@/src/theme/useTheme';

const WIDTH = 72;
const HEIGHT = 26;
const HALF = HEIGHT / 2;

/**
 * Rolling blended-score mini bars: one bar per weekly observation around a
 * zero baseline. Values arrive pre-squashed to [−2, 2]; nulls render as gaps.
 * Plain Views — no Skia in list rows.
 */
export function RollingBars({ values }: { values: (number | null)[] }) {
  const { colors } = useTheme();
  const n = values.length;
  const slot = WIDTH / n;
  const barW = Math.max(1.5, slot - 1);
  return (
    <View style={{ width: WIDTH, height: HEIGHT }}>
      <View
        style={{
          position: 'absolute',
          top: HALF - 0.5,
          width: WIDTH,
          height: 1,
          backgroundColor: colors.fillSubtle,
        }}
      />
      {values.map((v, i) => {
        if (v === null) return null;
        const h = Math.max(1.5, (Math.abs(v) / 2) * HALF);
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: i * slot,
              width: barW,
              height: h,
              top: v >= 0 ? HALF - h : HALF,
              borderRadius: 1,
              backgroundColor: v >= 0 ? colors.positive : colors.negative,
            }}
          />
        );
      })}
    </View>
  );
}
