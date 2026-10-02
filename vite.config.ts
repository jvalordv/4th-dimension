import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: true },
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    // Several checks slice complexes of 10⁴–10⁵ tets many times (Cavalieri
    // integrals, duocylinder scans). They take 1–5 s here and longer on a
    // slow shared CI runner; none can hang, so a generous limit is safe.
    testTimeout: 120_000,
  },
});
