import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/migrations/*.pb.ts'],
  outDir: 'pb_migrations',
  format: ['cjs'],
  platform: 'node',
  target: 'es2020',
  splitting: false,
  clean: false
});
