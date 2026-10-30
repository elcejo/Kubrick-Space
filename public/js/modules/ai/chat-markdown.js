const entities = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
});

function decodeTextEntities(value) {
  return String(value ?? '').replace(
    /&(?:#x([\da-f]{1,6})|#(\d{1,7})|([a-z]+));/gi,
    (match, hex, decimal, name) => {
      if (name) return entities[name.toLowerCase()] ?? match;
      const point = Number.parseInt(hex || decimal, hex ? 16 : 10);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    },
  );
}

function escapeHTML(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );
}

function inlineMarkdown(source) {
  // Some providers wrap strong+emphasis with more than three stars. Normalize
  // the wrapper before parsing so the original emphasis remains readable.
  let text = decodeTextEntities(source).replace(/\*{3,}([^\n]+?)\*{3,}/g, '***$1***');
  const code = [];
  text = text.replace(/`([^`\n]+)`/g, (_, value) => {
    const index = code.push(`<code>${escapeHTML(value)}</code>`) - 1;
    return `\uE000${index}\uE001`;
  });

  let html = escapeHTML(text);
  html = html
    .replace(/\*\*\*([^*\n](?:.*?[^*\n])?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/___([^_\n](?:.*?[^_\n])?)___/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');

  return html.replace(/\uE000(\d+)\uE001/g, (_, index) => code[Number(index)] || '');
}

function listMarker(line) {
  const match = line.match(/^\s{0,8}([-+*]|\d+[.)])\s+(.+)$/);
  if (!match) return null;
  return { ordered: /^\d/.test(match[1]), text: match[2] };
}

/** Convert common model-generated HTML formatting into Markdown before the
 * escaped renderer sees it. Raw HTML remains non-executable and unknown tags
 * are discarded while their text is kept. Code spans/fences are left intact.
 */
function normalizeModelHTML(source) {
  const parts = String(source ?? '').split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);
  return parts
    .map((part, index) => {
      if (index % 2) return part;
      let text = part;
      text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
      text = text.replace(
        /<pre\b[^>]*>\s*<code\b[^>]*>([\s\S]*?)<\/code\s*>\s*<\/pre\s*>/gi,
        (_, code) => `\n\n\`\`\`\n${code}\n\`\`\`\n\n`,
      );
      text = text.replace(
        /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi,
        (_, level, content) => `\n\n${'#'.repeat(Number(level))} ${content}\n\n`,
      );
      text = text.replace(
        /<blockquote\b[^>]*>([\s\S]*?)<\/blockquote\s*>/gi,
        (_, content) =>
          `\n\n${content
            .trim()
            .split(/\r?\n/)
            .map((line) => `> ${line}`)
            .join('\n')}\n\n`,
      );
      text = text.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol\s*>/gi, (_, list) => {
        let number = 0;
        return `\n\n${list.replace(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi, (_item, content) => `${++number}. ${content.trim()}\n`)}\n`;
      });
      text = text.replace(
        /<ul\b[^>]*>([\s\S]*?)<\/ul\s*>/gi,
        (_, list) =>
          `\n\n${list.replace(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi, (_item, content) => `- ${content.trim()}\n`)}\n`,
      );
      text = text
        .replace(/<\/?(?:p|div|section|article|header|footer|main|aside)\b[^>]*>/gi, '\n\n')
        .replace(/<br\b[^>]*\/?>/gi, '\n')
        .replace(/<hr\b[^>]*\/?>/gi, '\n\n---\n\n')
        .replace(/<(?:strong|b)\b[^>]*>/gi, '**')
        .replace(/<\/(?:strong|b)\s*>/gi, '**')
        .replace(/<(?:em|i)\b[^>]*>/gi, '*')
        .replace(/<\/(?:em|i)\s*>/gi, '*')
        .replace(/<(?:del|s|strike)\b[^>]*>/gi, '~~')
        .replace(/<\/(?:del|s|strike)\s*>/gi, '~~')
        .replace(/<code\b[^>]*>/gi, '`')
        .replace(/<\/code\s*>/gi, '`')
        .replace(/<a\b[^>]*>/gi, '')
        .replace(/<\/a\s*>/gi, '')
        .replace(/<\/?li\b[^>]*>/gi, '\n')
        // Unknown tags (including styled spans) never reach innerHTML. Keep
        // their readable text but remove the presentation-only markup.
        .replace(/<\/?[a-z][\w:-]*\b[^>]*>/gi, '')
        .replace(/\n{3,}/g, '\n\n');
      // Hide an unfinished tag at the end of a streamed chunk instead of briefly
      // showing fragments like "<stro" while the model is still writing it.
      return text.replace(/<\/?[a-z][\w:-]*\b[^>]*$/i, '');
    })
    .join('');
}

/** Render the common Markdown emitted by chat models as escaped HTML. */
export function markdownToHTML(markdown) {
  const lines = decodeTextEntities(normalizeModelHTML(markdown)).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }

    if (/^\s*```/.test(line)) {
      index++;
      const code = [];
      while (index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push(`<pre><code>${escapeHTML(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      index++;
      continue;
    }

    if (/^\s{0,3}(?:[-*_]\s*){3,}$/.test(line)) {
      blocks.push('<hr>');
      index++;
      continue;
    }

    if (/^\s{0,3}>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s{0,3}>/.test(lines[index]))
        quote.push(lines[index++].replace(/^\s{0,3}>\s?/, ''));
      blocks.push(`<blockquote>${markdownToHTML(quote.join('\n'))}</blockquote>`);
      continue;
    }

    const marker = listMarker(line);
    if (marker) {
      const items = [];
      const ordered = marker.ordered;
      while (index < lines.length) {
        const current = listMarker(lines[index]);
        if (!current || current.ordered !== ordered) break;
        items.push(`<li>${inlineMarkdown(current.text)}</li>`);
        index++;
      }
      const tag = ordered ? 'ol' : 'ul';
      blocks.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    const paragraph = [line];
    index++;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^\s{0,3}(?:#{1,6}\s|>|```)/.test(lines[index]) &&
      !listMarker(lines[index]) &&
      !/^\s{0,3}(?:[-*_]\s*){3,}$/.test(lines[index])
    ) {
      paragraph.push(lines[index++]);
    }
    blocks.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
  }

  return blocks.join('');
}
