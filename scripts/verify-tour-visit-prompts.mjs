import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const root = 'docs/phase-progress/evidence';
const checks = [
  ['client', ['node_modules/vitest/vitest.mjs', 'run', 'client/src/lib/chef-viewing-display.test.ts', 'client/src/components/tour-b-consumers.test.tsx', 'client/src/components/chef/ChefViewingsList.test.tsx', 'client/src/components/admin/sections/AdminTourRequestsSection.test.tsx', '--maxWorkers=2']],
  ['delivery', ['node_modules/vitest/vitest.mjs', 'run', '-c', 'vitest.config.server.ts', 'server/services/tour-delivery-service.test.ts', '--maxWorkers=2']],
  ['types', ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['project', ['node_modules/typescript/bin/tsc', '-b']],
  ['build', ['node_modules/vite/bin/vite.js', 'build']],
];
let failed = false;
const requested = new Set(process.argv.slice(2));
for (const [name, args] of checks) {
  if (requested.size && !requested.has(name)) continue;
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true,
    env: { ...process.env, SENTRY_AUTH_TOKEN: '' }, maxBuffer: 20 * 1024 * 1024 });
  const output = `Command: Node ${args.join(' ')}\nEXIT ${result.status}\n${result.stdout || ''}${result.stderr || ''}${result.error || ''}`;
  fs.writeFileSync(`${root}/tour-visit-prompts-${name}.log`, output);
  console.log(`${name}: exit ${result.status}`);
  if (result.status !== 0) { failed = true; console.log(output.slice(-12000)); }
}
process.exitCode = failed ? 1 : 0;
