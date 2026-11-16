module.exports = {
  entry: { 'index': './src/main.ts', 'coordinator': './src/coordinator.ts', 'claude-worker': './src/claude/worker.ts', 'execution-guardian': './src/execution/guardian-process.ts' },
  output: { filename: '[name].cjs' },
  module: { rules: require('./webpack.rules.cjs') },
  // Select the supported target at build time, keeping OS choices out of the coordinator.
  resolve: { extensions: ['.ts', '.js', '.json'], alias: { 'better-sqlite3$': 'better-sqlite3/darwin-arm64',
    '@anthropic-ai/claude-agent-sdk$': require.resolve('@anthropic-ai/claude-agent-sdk/core') } },
};
