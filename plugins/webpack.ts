/**
 * Webpack plugin for Website Overlay.
 *
 * Usage:
 *   const { WebsiteOverlayPlugin } = require('website-overlay/webpack');
 *   // webpack.config.js
 *   module.exports = {
 *     plugins: [new WebsiteOverlayPlugin()],
 *   };
 *
 * What it does (dev only):
 *   Adds a babel-loader rule that runs the shared babel transform to stamp
 *   data-overlay-src on all JSX/TSX files outside node_modules.
 */

import path from 'node:path';

interface Options {
  /** Only stamp in development mode. Default: true */
  devOnly?: boolean;
}

export class WebsiteOverlayPlugin {
  private opts: Options;

  constructor(opts: Options = {}) {
    this.opts = opts;
  }

  apply(compiler: any) {
    const devOnly = this.opts.devOnly !== false;
    if (devOnly && compiler.options.mode === 'production') return;

    const babelPluginPath = path.resolve(__dirname, '../shared/babel-plugin.js');

    compiler.options.module.rules.push({
      test: /\.[jt]sx$/,
      exclude: /node_modules/,
      enforce: 'pre' as const,
      use: [
        {
          loader: 'babel-loader',
          options: {
            plugins: [babelPluginPath],
            configFile: false,
            babelrc: false,
          },
        },
      ],
    });
  }
}
