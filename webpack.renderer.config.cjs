module.exports = {
  devtool: 'source-map',
  module: { rules: [
    require('./webpack.rules.cjs')[0],
    { test: /\.css$/, use: ['style-loader', 'css-loader'] },
  ] },
  resolve: { extensions: ['.tsx', '.ts', '.js'] },
};
