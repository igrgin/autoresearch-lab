module.exports = {
  packagerConfig: { asar: { unpack: '**/*.node' }, appBundleId: 'dev.igrgin.autoresearch-lab' },
  rebuildConfig: {},
  makers: [{ name: '@electron-forge/maker-zip', platforms: ['darwin'] }],
  plugins: [
    { name: '@electron-forge/plugin-auto-unpack-natives', config: {} },
    { name: '@electron-forge/plugin-webpack', config: {
      mainConfig: './webpack.main.config.cjs',
      // The narrow sandboxed preload needs no browser HMR client. Reload via the native menu.
      devServer: { host: 'localhost', hot: false, client: false, liveReload: false },
      devContentSecurityPolicy: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'",
      renderer: {
        config: './webpack.renderer.config.cjs',
        entryPoints: [{
          name: 'main_window', html: './src/renderer/index.html', js: './src/renderer/index.tsx',
          preload: { js: './src/preload.ts' },
        }],
      },
    } },
  ],
};
