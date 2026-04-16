import type { QueueItem } from './types';

/**
 * Format the queue as structured markdown suitable for pasting into an AI
 * coding tool (Claude Code, Cursor, Windsurf, etc.).
 */
export function formatQueueForClipboard(queue: QueueItem[]): string {
  if (queue.length === 0) return '(empty queue)';

  const lines: string[] = ['## UI Changes Requested\n'];

  for (const item of queue) {
    for (const el of item.elements) {
      const tag = `<${el.tagName}${el.classes ? ` class="${el.classes.split(' ').slice(0, 3).join(' ')}"` : ''}>`;
      const textSnippet = el.text ? el.text.slice(0, 60) : '';
      lines.push(`### ${el.label} \`${tag}${textSnippet ? `${textSnippet}` : ''}\``);
      lines.push(`- **Page**: ${el.pageUrl}`);
      lines.push(`- **Selector**: \`${el.selector}\``);
      if (el.sourceFile) {
        lines.push(
          `- **Source**: \`${shortPath(el.sourceFile)}:${el.sourceLine ?? '?'}\``,
        );
      }
      if (el.attributes['data-testid']) {
        lines.push(`- **Test ID**: \`${el.attributes['data-testid']}\``);
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
