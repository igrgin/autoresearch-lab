const path = require('node:path');
module.exports = [
  { mode: 'development', target: 'node', devtool: false,
    entry: { 'main': './tests/metadata-ui-main.ts', 'preload': './src/preload.ts' },
    output: { path: path.resolve('.webpack/metadata-tests'), filename: '[name].cjs' },
    externals: { electron: 'commonjs electron' },
    module: { rules: [require('./webpack.rules.cjs')[0]] }, resolve: { extensions: ['.ts', '.js'] } },
  { mode: 'development', target: 'web', devtool: false, entry: './tests/metadata-ui-renderer.tsx',
    output: { path: path.resolve('.webpack/metadata-tests'), filename: 'renderer.js' },
    module: { rules: [require('./webpack.rules.cjs')[0], { test: /\.css$/, use: ['style-loader', 'css-loader'] }] },
    resolve: { extensions: ['.tsx', '.ts', '.js'] } },
];
