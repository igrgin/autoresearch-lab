module.exports = {
  mode: 'development', target: 'node', devtool: false,
  externals: { electron: 'commonjs electron' },
  entry: { 'codex-transport-main': './tests/codex-transport-main.ts', 'codex-transport-worker': './tests/codex-transport-worker.ts', 'configuration': './tests/configuration.test.ts', 'catalog': './tests/catalog.test.ts', 'crash-worker': './tests/crash-worker.ts', 'reservations': './tests/reservations.test.ts', 'reservation-worker': './tests/reservation-worker.ts', 'research': './tests/research.test.ts', 'research-crash': './tests/research-crash.ts', 'import-crash-worker': './tests/import-crash-worker.ts', 'imports': './tests/imports.test.ts', 'vast': './tests/vast.test.ts', 'codex': './tests/codex.test.ts', 'codex-fixture': './tests/codex-fixture.ts', 'claude': './tests/claude.test.ts', 'checkpoints': './tests/checkpoints.test.ts' },
  output: { path: require('node:path').resolve('.webpack/tests'), filename: '[name].cjs' },
  module: { rules: require('./webpack.rules.cjs') },
  resolve: { extensions: ['.ts', '.js', '.json'], alias: { 'better-sqlite3$': 'better-sqlite3/darwin-arm64' } },
};
