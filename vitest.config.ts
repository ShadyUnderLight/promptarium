import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { fileURLToPath } from 'node:url';

// Component-level test config for the Svelte library (Issue #30 hardening).
// `svelteTesting()` sets the browser resolve condition so Svelte 5 resolves to
// the client runtime (`mount` is a client-only API). SvelteKit's `$lib` alias
// lives in the generated .svelte-kit tsconfig, which Vitest does not load, so
// it is mirrored here explicitly.
export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});
