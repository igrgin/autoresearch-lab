import { execFileSync } from 'node:child_process';
import electron from 'electron';
import webpack from 'webpack';
import config from '../webpack.tests.config.cjs';

const domainSuites = ['catalog', 'configuration', 'reservations', 'research', 'research-security-client', 'imports', 'vast', 'codex', 'claude', 'checkpoints'];
const [mode, suite, ...extra] = process.argv.slice(2);
const focused = mode === '--focused';
if (mode !== undefined && (!focused || !domainSuites.includes(suite) || extra.length)) {
  throw new Error(`Usage: npm run test:focused -- <${domainSuites.join('|')}>`);
}

const testOptions = ['--test'];
if (focused && suite === 'imports') {
  const stressTest = 'inventory above record node limit completes without quarantine and remains usable after restart';
  console.info(`Focused import run skips "${stressTest}". Run npm run check for the full suite.`);
  testOptions.push(`--test-skip-pattern=^${stressTest}$`);
}
const files = (focused ? [suite] : domainSuites).map(name => `.webpack/tests/${name}.cjs`);

await new Promise((resolve, reject) => {
  const compiler = webpack(config);
  compiler.run((error, stats) => {
    compiler.close(() => {});
    if (error) return reject(error);
    if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })));
    resolve();
  });
});
execFileSync(electron, [...testOptions, ...files], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
