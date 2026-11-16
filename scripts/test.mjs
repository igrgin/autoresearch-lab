import { execFileSync } from 'node:child_process';
import electron from 'electron';
import webpack from 'webpack';
import config from '../webpack.tests.config.cjs';

await new Promise((resolve, reject) => {
  const compiler = webpack(config);
  compiler.run((error, stats) => {
    compiler.close(() => {});
    if (error) return reject(error);
    if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })));
    resolve();
  });
});
execFileSync(electron, ['--test', '.webpack/tests/catalog.cjs', '.webpack/tests/configuration.cjs', '.webpack/tests/reservations.cjs', '.webpack/tests/research.cjs', '.webpack/tests/research-security-client.cjs', '.webpack/tests/imports.cjs', '.webpack/tests/vast.cjs', '.webpack/tests/codex.cjs', '.webpack/tests/claude.cjs'], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
