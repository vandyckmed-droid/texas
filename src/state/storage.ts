/**
 * Tiny typed AsyncStorage wrapper. Keys are namespaced and versioned —
 * bumping the version is the migration strategy for this personal app.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const KEYS = {
  watchlist: 'texas.v1.watchlist',
  settings: 'texas.v1.settings',
} as const;

export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function setJSON(key: string, value: unknown): void {
  AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});
}
