import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/hooks/*.pb.ts',
    'src/hooks/_shared/*.ts',
    'src/hooks/deadline-reminder-cron.pb.ts',
    'src/hooks/utils/*.ts',
    'src/hooks/services/phase-engine.ts',
    'src/hooks/services/phase-data.ts',
    'src/hooks/services/label-engine.ts',
    'src/hooks/services/ballot-engine.ts',
    'src/hooks/services/score-recalc-engine.ts',
    'src/hooks/services/finalization-engine.ts',
    'src/hooks/services/voting-engine.ts',
    'src/hooks/services/push-notifications-engine.ts',
    'src/hooks/services/push-translations.ts',
    'src/hooks/services/label-rules.ts'
  ],
  outDir: 'pb_hooks',
  format: ['cjs'],
  platform: 'node',
  target: 'es2020',
  splitting: false,
  clean: false
});
