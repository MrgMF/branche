import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
  resolve: {
    alias: {
      'expo-constants': new URL('./test/expo-constants.ts', import.meta.url).pathname,
      '@react-native-async-storage/async-storage': new URL('./test/async-storage.ts', import.meta.url).pathname,
    },
  },
});
