/**
 * Haptic vocabulary: `tick` for fine-grained selection steps (crosshair,
 * segmented controls), `tap` for discrete actions (watchlist toggle,
 * prev/next). Errors are swallowed — haptics are garnish, never load-bearing.
 */
import * as Haptics from 'expo-haptics';

export function tick(): void {
  Haptics.selectionAsync().catch(() => {});
}

export function tap(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
