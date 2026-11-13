module.exports = {
  entry: { index: './src/main.ts', coordinator: './src/coordinator.ts' },
  output: { filename: '[name].cjs' },
  module: { rules: require('./webpack.rules.cjs') },
  // Select the supported target at build time, keeping OS choices out of the coordinator.
  resolve: { extensions: ['.ts', '.js', '.json'], alias: { 'better-sqlite3$': 'better-sqlite3/darwin-arm64' } },
};
