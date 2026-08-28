import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { tick } from '@/src/theme/haptics';
import { motion, typo, type Theme } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { ChartFile } from '@/shared/types';
import { CandleChart } from './CandleChart';
import { LineChart } from './LineChart';
import { barForX, barForXLine, padDomain, windowBars, yFor, type ChartFrame, type WindowKey } from './scales';
import { PriceText } from '@/src/components/PriceText';
import { formatPrice } from '@/src/data/format';

export type ChartKind = 'line' | 'candle';

interface Props {
  chart: ChartFile;
  window: WindowKey;
  kind: ChartKind;
  width: number;
  height: number;
  /** Bar index within the current window while the crosshair is held; null off. */
  onReadout: (index: number | null) => void;
}

const LABEL_GUTTER = 46;

/**
 * Chart container: owns the crosshair gesture (long-press then drag, so the
 * page still scrolls), the readout reaction with haptic ticks, and the
 * y-axis labels, and crossfades between line and candle renderers.
 */
export function PriceChart({ chart, window: win, kind, width, height, onReadout }: Props) {
  const theme = useTheme();
  const s = styles(theme);
  const frame: ChartFrame = useMemo(
    () => ({ width, height, labelGutter: LABEL_GUTTER, padTop: 8, padBottom: 8 }),
    [width, height],
  );

  const n = windowBars(win, chart.c.length);
  const activeIndex = useSharedValue(-1);
  const crossOpacity = useSharedValue(0);

  // Reset the crosshair when window or kind changes.
  useEffect(() => {
    activeIndex.value = -1;
    crossOpacity.value = 0;
    onReadout(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win, kind, chart]);

  // Candles are laid out on bar centres, the line edge-to-edge; using one
  // inverse for both skews the hairline by up to half a slot near the edges.
  const indexAt = kind === 'candle' ? barForX : barForXLine;

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(150)
        .onStart((e) => {
          activeIndex.value = indexAt(e.x, n, frame);
          crossOpacity.value = withTiming(1, { duration: motion.fast });
        })
        .onUpdate((e) => {
          activeIndex.value = indexAt(e.x, n, frame);
        })
        .onFinalize(() => {
          crossOpacity.value = withTiming(0, { duration: motion.fast });
          activeIndex.value = -1;
        }),
    [n, frame, indexAt, activeIndex, crossOpacity],
  );

  useAnimatedReaction(
    () => activeIndex.value,
    (cur, prev) => {
      if (cur === prev) return;
      runOnJS(onReadout)(cur < 0 ? null : cur);
      if (cur >= 0 && prev !== null && prev >= 0) runOnJS(tick)();
    },
  );

  // y-axis labels: the window's REAL high, midpoint and low, each placed at its
  // true position inside the padded domain. Labelling the padded bounds instead
  // prints prices the stock never traded at — and on a wide range the padding
  // can push the bottom label below zero.
  const labels = useMemo(() => {
    const values =
      kind === 'line'
        ? chart.c.slice(chart.c.length - n)
        : [...chart.l.slice(chart.c.length - n), ...chart.h.slice(chart.c.length - n)];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const [lo, hi] = padDomain(min, max);
    return [max, (min + max) / 2, min].map((v) => ({
      value: formatPrice(v),
      y: yFor(v, lo, hi, frame),
    }));
  }, [chart, n, kind, frame]);

  const chartProps = { chart, window: win, frame, activeIndex, crossOpacity };

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width, height }}>
        <Animated.View
          key={`labels-${win}-${kind}`}
          entering={FadeIn.duration(motion.fast)}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          {labels.map((l, i) => (
            <View key={i} style={[s.gridRow, { top: l.y }]}>
              <View style={s.gridLine} />
              <PriceText style={s.gridLabel}>{l.value}</PriceText>
            </View>
          ))}
        </Animated.View>
        {kind === 'line' ? (
          <Animated.View
            key="line"
            entering={FadeIn.duration(motion.fast)}
            exiting={FadeOut.duration(motion.fast)}
            style={StyleSheet.absoluteFill}
          >
            <LineChart {...chartProps} />
          </Animated.View>
        ) : (
          <Animated.View
            key="candle"
            entering={FadeIn.duration(motion.fast)}
            exiting={FadeOut.duration(motion.fast)}
            style={StyleSheet.absoluteFill}
          >
            <CandleChart {...chartProps} />
          </Animated.View>
        )}
      </View>
    </GestureDetector>
  );
}

const styles = (theme: Theme) =>
  StyleSheet.create({
    gridRow: {
      position: 'absolute',
      left: 0,
      right: 0,
      flexDirection: 'row',
      alignItems: 'center',
      transform: [{ translateY: -6 }],
    },
    gridLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.separator,
    },
    gridLabel: {
      width: LABEL_GUTTER,
      textAlign: 'right',
      ...typo.micro,
      color: theme.colors.textTertiary,
      paddingLeft: 4,
    },
  });
