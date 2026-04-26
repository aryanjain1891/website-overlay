/**
 * Next.js config wrapper for Website Overlay.
 *
 * Usage:
 *   // next.config.js
 *   const { withWebsiteOverlay } = require('website-overlay/next');
 *   module.exports = withWebsiteOverlay(nextConfig);
 *
 * What it does (dev only):
 *   Injects the shared babel transform into Next.js's webpack config so that
 *   all JSX/TSX files get stamped with data-overlay-src="file:line:col".
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// __dirname is undefined in ESM; reconstruct it from import.meta.url so
// path.resolve below can find the babel plugin at runtime.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface NextConfig {
  webpack?: (config: any, context: any) => any;
  [key: string]: any;
}

export function withWebsiteOverlay(nextConfig: NextConfig = {}): NextConfig {
  return {
    ...nextConfig,
    webpack(config: any, context: any) {
      if (context.dev) {
        const babelPluginPath = path.resolve(__dirname, '../shared/babel-plugin.js');

        config.module.rules.push({
          test: /\.[jt]sx$/,
          exclude: /node_modules/,
          enforce: 'pre',
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

      if (typeof nextConfig.webpack === 'function') {
        return nextConfig.webpack(config, context);
      }
      return config;
    },
  };
}
