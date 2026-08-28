import { Canvas, Circle, Group, Line, Path, Skia, vec } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { useTheme } from '@/src/theme/useTheme';
import type { ChartFile } from '@/shared/types';
import {
  padDomain,
  plotWidth,
  windowBars,
  xForBar,
  yFor,
  type ChartFrame,
  type WindowKey,
} from './scales';

interface Props {
  chart: ChartFile;
  window: WindowKey;
  frame: ChartFrame;
  activeIndex: SharedValue<number>;
  crossOpacity: SharedValue<number>;
}

interface WindowGeometry {
  wicks: ReturnType<typeof Skia.Path.Make>;
  up: ReturnType<typeof Skia.Path.Make>;
  down: ReturnType<typeof Skia.Path.Make>;
  lo: number;
  hi: number;
  n: number;
  closes: number[];
}

/**
 * OHLC candles.
 *
 * Geometry for every window is built once, on mount, and simply swapped — the
 * earlier version rebuilt three Skia paths inside a per-frame worklet and
 * stored them wrapped in an object on a shared value, which allocated ~180
 * native objects a second and could tear down a path while the canvas still
 * held it. Window changes now swap prebuilt paths outright: the smooth rescale
 * is traded for a chart that always draws, at full strength, immediately.
 */
export function CandleChart({ chart, window: win, frame, activeIndex, crossOpacity }: Props) {
  const theme = useTheme();
  const plotW = plotWidth(frame);
  const len = chart.c.length;

  // Only the window on screen is built: holding all four alive meant twelve
  // Skia paths per ticker, which accumulated when flicking through names.
  const geo = useMemo<WindowGeometry>(() => {
    const n = windowBars(win, len);
    const start = len - n;
    let min = Infinity;
    let max = -Infinity;
    for (let i = start; i < len; i++) {
      if (chart.l[i] < min) min = chart.l[i];
      if (chart.h[i] > max) max = chart.h[i];
    }
    const [lo, hi] = padDomain(min, max);
    const slot = plotW / n;
    const bodyW = Math.max(0.8, Math.min(slot * 0.72, slot - 0.6));
    const wicks = Skia.Path.Make();
    const up = Skia.Path.Make();
    const down = Skia.Path.Make();
    for (let k = 0; k < n; k++) {
      const i = start + k;
      const x = (k + 0.5) * slot;
      wicks.moveTo(x, yFor(chart.h[i], lo, hi, frame));
      wicks.lineTo(x, yFor(chart.l[i], lo, hi, frame));
      const yO = yFor(chart.o[i], lo, hi, frame);
      const yC = yFor(chart.c[i], lo, hi, frame);
      const target = chart.c[i] >= chart.o[i] ? up : down;
      target.addRect(
        Skia.XYWHRect(x - bodyW / 2, Math.min(yO, yC), bodyW, Math.max(1, Math.abs(yO - yC))),
      );
    }
    return { wicks, up, down, lo, hi, n, closes: chart.c.slice(start) };
  }, [chart, win, len, plotW, frame]);

  // Drawn at full strength with no entrance animation: an opacity that depends
  // on a timing animation completing renders the candles dim (or invisible) if
  // that animation never runs.
  const { n, lo, hi, closes } = geo;
  const cx = useDerivedValue(() =>
    activeIndex.value < 0 ? -100 : xForBar(Math.min(activeIndex.value, n - 1), n, frame),
  );
  const cy = useDerivedValue(() =>
    activeIndex.value < 0 ? -100 : yFor(closes[Math.min(activeIndex.value, n - 1)], lo, hi, frame),
  );
  const p1 = useDerivedValue(() => vec(cx.value, frame.padTop));
  const p2 = useDerivedValue(() => vec(cx.value, frame.height - frame.padBottom));

  return (
    <Canvas style={{ width: frame.width, height: frame.height }}>
      <Path path={geo.wicks} style="stroke" strokeWidth={1} color={theme.colors.textTertiary} />
      <Path path={geo.up} color={theme.colors.positive} />
      <Path path={geo.down} color={theme.colors.negative} />
      <Group opacity={crossOpacity}>
        <Line p1={p1} p2={p2} strokeWidth={1} color={theme.colors.crosshair} />
        <Circle cx={cx} cy={cy} r={3.5} color={theme.colors.crosshair} />
      </Group>
    </Canvas>
  );
}
