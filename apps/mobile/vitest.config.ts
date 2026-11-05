import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
  resolve: { alias: { 'expo-constants': new URL('./test/expo-constants.ts', import.meta.url).pathname } },
});
