/**
 * Babel plugin that stamps `data-overlay-src="<file>:<line>:<col>"` on every
 * intrinsic (lowercase) JSX element in source files outside node_modules.
 *
 * Used by:
 *   - plugins/vite.ts
 *   - plugins/webpack.ts (via babel-loader)
 *   - plugins/next.ts (via Next.js webpack config)
 *
 * Import and pass to Babel:
 *   import { overlayBabelPlugin } from 'website-overlay/shared/babel-plugin';
 *   // or use the framework-specific wrapper which does this for you.
 */

export function overlayBabelPlugin({ types: t }: { types: any }): any {
  return {
    name: 'website-overlay-source-stamp',
    visitor: {
      JSXOpeningElement(path: any, state: any) {
        const filename: string | undefined = state.file.opts.filename;
        if (!filename || filename.includes('node_modules')) return;

        const nameNode = path.node.name;
        if (nameNode.type !== 'JSXIdentifier') return;
        const tag: string = nameNode.name;
        // Only intrinsic DOM elements (lowercase).
        if (!/^[a-z]/.test(tag)) return;

        const hasAttr = path.node.attributes.some(
          (a: any) =>
            a.type === 'JSXAttribute' &&
            a.name?.type === 'JSXIdentifier' &&
            a.name.name === 'data-overlay-src',
        );
        if (hasAttr) return;

        const loc = path.node.loc;
        if (!loc) return;

        path.node.attributes.push(
          t.jSXAttribute(
            t.jSXIdentifier('data-overlay-src'),
            t.stringLiteral(
              `${filename}:${loc.start.line}:${loc.start.column}`,
            ),
          ),
        );
      },
    },
  };
}
