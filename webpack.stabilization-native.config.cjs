const path = require('node:path');
const { DefinePlugin } = require('webpack');
const directory = path.resolve('.webpack/stabilization-native');
const { pathToFileURL } = require('node:url');
const entry = name => JSON.stringify(pathToFileURL(path.join(directory, `${name}.html`)).href);
module.exports = [
  { ...require('./webpack.main.config.cjs'), mode: 'development', target: 'electron-main', devtool: false,
    entry: { main: './src/main.ts', coordinator: './src/coordinator.ts' },
    output: { path: directory, filename: '[name].cjs' },
    plugins: [new DefinePlugin({ MAIN_WINDOW_WEBPACK_ENTRY: entry('main'), CREDENTIAL_WINDOW_WEBPACK_ENTRY: entry('credential'),
      MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: JSON.stringify(path.join(directory, 'preload.cjs')),
      CREDENTIAL_WINDOW_PRELOAD_WEBPACK_ENTRY: JSON.stringify(path.join(directory, 'credential-preload.cjs')) })] },
  { mode: 'development', target: 'electron-preload', devtool: false,
    entry: { preload: './src/preload.ts', 'credential-preload': './src/credential-preload.ts' },
    output: { path: directory, filename: '[name].cjs' }, module: { rules: [require('./webpack.rules.cjs')[0]] },
    resolve: { extensions: ['.ts', '.js'] } },
  { ...require('./webpack.renderer.config.cjs'), mode: 'development', target: 'web', devtool: false,
    entry: { renderer: './src/renderer/index.tsx', credential: './src/renderer/credential-entry.tsx' },
    output: { path: directory, filename: '[name].js' } },
];
