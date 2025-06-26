const DocsHMRPlugin = require('./webpack/docs-hmr-plugin');

module.exports = {
  plugins: [
    new DocsHMRPlugin({
      docsPath: 'src/assets/docs',
      outputPath: 'src/assets/docs-list.json'
    })
  ],
  
  // Add docs files to the watch list
  resolve: {
    // Ensure markdown files are watched
    extensions: ['.ts', '.js', '.md']
  },
  
  // Development server configuration
  devServer: {
    watchFiles: [
      'src/assets/docs/**/*.md',
      'src/assets/docs-list.json'
    ],
    hot: true,
    liveReload: true
  }
};
