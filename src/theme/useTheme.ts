import { useColorScheme } from 'react-native';
import { useSettings } from '@/src/state/SettingsContext';
import { darkTheme, lightTheme, type Theme } from './tokens';

/** Resolves the OS color scheme against the in-app appearance override. */
export function useTheme(): Theme {
  const system = useColorScheme();
  const { settings } = useSettings();
  const resolved = settings.appearance === 'system' ? (system ?? 'light') : settings.appearance;
  return resolved === 'dark' ? darkTheme : lightTheme;
}
