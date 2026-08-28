import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SettingsProvider, useSettings } from '@/src/state/SettingsContext';
import { WatchlistProvider } from '@/src/state/WatchlistContext';
import { useTheme } from '@/src/theme/useTheme';

function ThemedApp() {
  const theme = useTheme();
  const { settings } = useSettings();
  const statusStyle =
    settings.appearance === 'system' ? 'auto' : settings.appearance === 'dark' ? 'light' : 'dark';
  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="ticker/[symbol]" />
        <Stack.Screen name="correlation" />
      </Stack>
      <StatusBar style={statusStyle} />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SettingsProvider>
        <WatchlistProvider>
          <ThemedApp />
        </WatchlistProvider>
      </SettingsProvider>
    </GestureHandlerRootView>
  );
}
