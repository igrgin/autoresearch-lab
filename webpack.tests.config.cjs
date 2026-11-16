module.exports = {
  mode: 'development', target: 'node', devtool: false,
  entry: { 'configuration': './tests/configuration.test.ts', 'catalog': './tests/catalog.test.ts', 'crash-worker': './tests/crash-worker.ts', 'reservations': './tests/reservations.test.ts', 'reservation-worker': './tests/reservation-worker.ts', 'research': './tests/research.test.ts', 'research-crash': './tests/research-crash.ts' },
  output: { path: require('node:path').resolve('.webpack/tests'), filename: '[name].cjs' },
  module: { rules: require('./webpack.rules.cjs') },
  resolve: { extensions: ['.ts', '.js', '.json'], alias: { 'better-sqlite3$': 'better-sqlite3/darwin-arm64' } },
};
