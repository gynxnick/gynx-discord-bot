import { defineConfig } from 'tsup';

// Bundle workspace packages (TS source) into the app; keep real npm deps external.
export default defineConfig({
  entry: ['src/index.ts', 'src/scripts/register-commands.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@gynx\//],
  external: ['@prisma/client', '.prisma/client'],
});
