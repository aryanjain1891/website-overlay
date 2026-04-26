import type { QueueItem } from './types';

// Strip backticks from values that get embedded inside markdown `code` spans.
// A picked element whose text or selector contains a backtick would otherwise
// terminate the code span early and corrupt the pasted output.
const md = (s: string): string => s.replace(/`/g, "'");

/**
 * Format the queue as structured markdown suitable for pasting into an AI
 * coding tool (Claude Code, Cursor, Windsurf, etc.).
 */
export function formatQueueForClipboard(queue: QueueItem[]): string {
  if (queue.length === 0) return '(empty queue)';

  const lines: string[] = ['## UI Changes Requested\n'];

  for (const item of queue) {
    for (const el of item.elements) {
      const safeClasses = md(el.classes.split(' ').slice(0, 3).join(' '));
      const tag = `<${el.tagName}${safeClasses ? ` class="${safeClasses}"` : ''}>`;
      const textSnippet = el.text ? md(el.text.slice(0, 60)) : '';
      lines.push(`### ${el.label} \`${tag}${textSnippet}\``);
      lines.push(`- **Page**: ${el.pageUrl}`);
      lines.push(`- **Selector**: \`${md(el.selector)}\``);
      if (el.sourceFile) {
        lines.push(
          `- **Source**: \`${md(shortPath(el.sourceFile))}:${el.sourceLine ?? '?'}\``,
        );
      }
      if (el.attributes['data-testid']) {
        lines.push(`- **Test ID**: \`${md(el.attributes['data-testid'])}\``);
      }
      lines.push('');
    }

    lines.push(`> **Change**: ${item.comment}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n').trim();
}

function shortPath(abs: string): string {
  const srcIdx = abs.lastIndexOf('/src/');
  if (srcIdx >= 0) return abs.slice(srcIdx + 1);
  const parts = abs.split('/');
  return parts.slice(-3).join('/');
}
