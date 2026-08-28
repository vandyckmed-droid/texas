import { Canvas, Group, Path, Rect, Skia } from '@shopify/react-native-skia';
import React, { useEffect, useMemo } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { tick } from '@/src/theme/haptics';
import { motion } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { CorrelationCluster, CorrelationSet } from '@/shared/types';
import { BUCKETS, bucketColor, bucketFor, cellAt, type Poles } from './heatmapColor';

export interface Cell {
  row: number;
  col: number;
}

interface Props {
  set: CorrelationSet;
  /** Total matrix edge length in points. */
  size: number;
  /** When set, everything outside this cluster's diagonal block is dimmed. */
  focused: CorrelationCluster | null;
  selected: Cell | null;
  onSelect: (cell: Cell) => void;
}

/**
 * Leaf-ordered correlation matrix. Clusters are contiguous in that order, so
 * groups read as bright blocks on the diagonal.
 *
 * Cells are batched into one path per colour bucket (≤17 draw calls for 2500
 * cells) and rebuilt only when the data or layout changes — never per frame.
 * The inspection overlay rides on shared values instead.
 */
export function Heatmap({ set, size, focused, selected, onSelect }: Props) {
  const theme = useTheme();
  const n = set.tickers.length;
  const cell = size / n;

  const poles: Poles = useMemo(
    () => ({
      positive: theme.colors.corrPositive,
      negative: theme.colors.corrNegative,
      neutral: theme.colors.corrNeutral,
    }),
    [theme],
  );

  // One path per bucket: 2500 rects, ≤17 draw calls.
  const layers = useMemo(() => {
    const paths = Array.from({ length: BUCKETS }, () => Skia.Path.Make());
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        paths[bucketFor(set.matrix[i][j])].addRect(
          Skia.XYWHRect(j * cell, i * cell, cell, cell),
        );
      }
    }
    return paths.map((path, bucket) => ({ path, color: bucketColor(bucket, poles) }));
  }, [set, n, cell, poles]);

  // Cluster boundaries, drawn once as a single hairline path.
  const boundaries = useMemo(() => {
    const path = Skia.Path.Make();
    for (const cl of set.clusters) {
      for (const edge of [cl.start, cl.start + cl.size]) {
        if (edge === 0 || edge === n) continue;
        const at = edge * cell;
        path.moveTo(at, 0);
        path.lineTo(at, size);
        path.moveTo(0, at);
        path.lineTo(size, at);
      }
    }
    return path;
  }, [set, n, cell, size]);

  const active = useSharedValue(-1); // row * n + col, or −1
  const overlay = useSharedValue(0);

  // Keep the shared value in step with selection owned by the screen.
  useEffect(() => {
    active.value = selected ? selected.row * n + selected.col : -1;
    overlay.value = withTiming(selected ? 1 : 0, { duration: motion.fast });
  }, [selected, n, active, overlay]);

  const report = (encoded: number) => {
    if (encoded < 0) return;
    onSelect({ row: Math.floor(encoded / n), col: encoded % n });
  };

  useAnimatedReaction(
    () => active.value,
    (cur, prev) => {
      if (cur === prev || cur < 0) return;
      runOnJS(report)(cur);
      if (prev !== null && prev >= 0) runOnJS(tick)();
    },
  );

  const gesture = useMemo(() => {
    const pick = (x: number, y: number) => {
      'worklet';
      const hit = cellAt(x, y, cell, n);
      active.value = hit.row * n + hit.col;
      overlay.value = withTiming(1, { duration: motion.fast });
    };
    // Race with a long-press pan so the page can still be scrolled vertically.
    return Gesture.Race(
      Gesture.Tap().onStart((e) => pick(e.x, e.y)),
      Gesture.Pan()
        .activateAfterLongPress(120)
        .onStart((e) => pick(e.x, e.y))
        .onUpdate((e) => pick(e.x, e.y)),
    );
  }, [cell, n, active, overlay]);

  const bandX = useDerivedValue(() => (active.value < 0 ? -size : (active.value % n) * cell));
  const bandY = useDerivedValue(() =>
    active.value < 0 ? -size : Math.floor(active.value / n) * cell,
  );

  const scrim = focused
    ? {
        startPx: focused.start * cell,
        endPx: (focused.start + focused.size) * cell,
      }
    : null;

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={{ width: size, height: size }}>
        <Canvas style={{ width: size, height: size }}>
          {layers.map(({ path, color }, i) => (
            <Path key={i} path={path} color={color} />
          ))}
          <Path
            path={boundaries}
            style="stroke"
            strokeWidth={0.5}
            color={theme.colors.textTertiary}
            opacity={0.5}
          />
          {scrim && (
            <Group color={theme.colors.bg} opacity={0.74}>
              <Rect x={0} y={0} width={size} height={scrim.startPx} />
              <Rect x={0} y={scrim.endPx} width={size} height={size - scrim.endPx} />
              <Rect
                x={0}
                y={scrim.startPx}
                width={scrim.startPx}
                height={scrim.endPx - scrim.startPx}
              />
              <Rect
                x={scrim.endPx}
                y={scrim.startPx}
                width={size - scrim.endPx}
                height={scrim.endPx - scrim.startPx}
              />
            </Group>
          )}
          <Group opacity={overlay}>
            <Rect x={bandX} y={0} width={cell} height={size} color={theme.colors.text} opacity={0.16} />
            <Rect x={0} y={bandY} width={size} height={cell} color={theme.colors.text} opacity={0.16} />
            <Rect
              x={bandX}
              y={bandY}
              width={cell}
              height={cell}
              style="stroke"
              strokeWidth={1.5}
              color={theme.colors.text}
            />
          </Group>
        </Canvas>
      </Animated.View>
    </GestureDetector>
  );
}
