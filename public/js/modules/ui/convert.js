/**
 * Simple HTML ↔ Markdown conversions (lightweight, covers common cases).
 * A production build would use a proper parser; here we keep things dependency-free.
 */
export const Convert = {
  escapeHTML(unsafe) {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  /**
   * Converts Rich HTML (with close buttons, spans, styles) to Clean, Sanitised HTML.
   * @param {string} html
   * @returns {string}
   */
  htmlToMarkdown(html) {
    if (!html) return '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const div = doc.body;

    // 1. Remove all close buttons
    div.querySelectorAll('.kai-remove-btn').forEach((btn) => btn.remove());

    // 2. Convert span.kai-tag to <tag definition="...">
    div.querySelectorAll('.kai-tag').forEach((span) => {
      const tagEl = document.createElement('tag');
      const definition = span.dataset.definition || span.title || '';
      if (definition) {
        tagEl.setAttribute('definition', definition.trim());
      }
      let text = span.textContent.trim();
      if (text.endsWith('×')) {
        text = text.slice(0, -1).trim();
      } else if (text.endsWith('x') && text.length > 1 && !span.dataset.tag?.endsWith('x')) {
        text = text.slice(0, -1).trim();
      }
      tagEl.textContent = text;
      span.parentNode.replaceChild(tagEl, span);
    });

    // 3. Convert span.kai-block to plain text (unwrap lock feature)
    div.querySelectorAll('.kai-block').forEach((span) => {
      let text = span.textContent.replace(/🔒/g, '').trim();
      const textNode = document.createTextNode(text);
      span.parentNode.replaceChild(textNode, span);
    });

    // 3.5. Convert DIVs to Ps or unwrap them
    const blockTags = ['H1', 'H2', 'H3', 'H4', 'H5', 'P', 'UL', 'OL', 'PRE', 'BLOCKQUOTE'];
    Array.from(div.childNodes).forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'DIV') {
        const hasBlock = Array.from(child.querySelectorAll('*')).some((el) => blockTags.includes(el.tagName));
        if (!hasBlock) {
          const p = document.createElement('p');
          while (child.firstChild) {
            p.appendChild(child.firstChild);
          }
          div.replaceChild(p, child);
        } else {
          const parent = child.parentNode;
          while (child.firstChild) {
            parent.insertBefore(child.firstChild, child);
          }
          child.remove();
        }
      }
    });

    // Group any loose text nodes or inline elements into <p> tags
    const finalChildren = Array.from(div.childNodes);
    let currentParagraph = null;

    finalChildren.forEach((child) => {
      const isText = child.nodeType === Node.TEXT_NODE;
      const isElement = child.nodeType === Node.ELEMENT_NODE;
      const isBlock = isElement && blockTags.includes(child.tagName);

      if (isBlock) {
        currentParagraph = null;
      } else {
        // Ignore empty whitespace nodes when not grouping
        if (isText && !child.textContent.trim() && !currentParagraph) {
          child.remove();
          return;
        }

        if (!currentParagraph) {
          currentParagraph = document.createElement('p');
          div.insertBefore(currentParagraph, child);
        }

        currentParagraph.appendChild(child);
      }
    });

    // 4. Sanitise: remove disallowed tags and strip attributes on allowed tags
    const allowedTags = [
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'P',
      'BR',
      'STRONG',
      'B',
      'EM',
      'I',
      'U',
      'S',
      'STRIKE',
      'UL',
      'OL',
      'LI',
      'TAG',
      'LOCK',
      'AGE',
      'SKIN',
      'COMPLEXION',
      'VOICE',
      'PITCH',
      'LORE',
      'PSYCHOLOGY',
      'PSEUDONYMS',
      'CLOTHING',
      'BLOCKQUOTE',
    ];

    const cleanNode = (node) => {
      const children = Array.from(node.childNodes);
      for (let child of children) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const tagName = child.tagName;
          if (!allowedTags.includes(tagName)) {
            // Disallowed tag: replace it with its text content
            const textNode = document.createTextNode(child.textContent);
            child.parentNode.replaceChild(textNode, child);
          } else {
            // Allowed tag: strip all attributes except 'definition' on 'TAG'
            const attrs = Array.from(child.attributes);
            for (let attr of attrs) {
              if (tagName === 'TAG' && attr.name === 'definition') {
                continue;
              }
              child.removeAttribute(attr.name);
            }
            cleanNode(child);
          }
        }
      }
    };
    cleanNode(div);

    return div.innerHTML;
  },

  /**
   * Converts Clean HTML back to Rich HTML for WYSIWYG editing.
   * @param {string} cleanHtml
   * @returns {string}
   */
  markdownToHtml(cleanHtml) {
    if (!cleanHtml) return '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(cleanHtml, 'text/html');
    const div = doc.body;

    // 1. Convert <tag definition="..."> to span.kai-tag
    div.querySelectorAll('tag').forEach((tagEl) => {
      const span = document.createElement('span');
      const definition = tagEl.getAttribute('definition') || '';
      if (definition.startsWith('character:')) {
        span.className = 'kai-tag kai-character-tag';
      } else {
        span.className = 'kai-tag';
      }
      span.setAttribute('spellcheck', 'false');
      // Tags are editable in WYSIWYG mode so that deleting letters unwraps them
      let text = tagEl.textContent.trim();
      if (text.endsWith('×')) {
        text = text.slice(0, -1).trim();
      }
      span.dataset.tag = text;
      span.dataset.definition = definition;
      span.title = definition || text;
      span.textContent = text;
      tagEl.parentNode.replaceChild(span, tagEl);
    });

    // 2. Convert <lock> to plain text (unwrap lock feature)
    div.querySelectorAll('lock').forEach((lockEl) => {
      const text = lockEl.textContent.trim();
      const textNode = document.createTextNode(text);
      lockEl.parentNode.replaceChild(textNode, lockEl);
    });

    return div.innerHTML;
  },

  formatHTML(html) {
    if (!html) return '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const div = doc.body;

    const hasBlockChildren = (node) => {
      const blockTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'p', 'ul', 'ol', 'li', 'pre', 'blockquote'];
      for (let child of node.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          if (blockTags.includes(child.tagName.toLowerCase()) || hasBlockChildren(child)) {
            return true;
          }
        }
      }
      return false;
    };

    const formatHTMLNode = (node, level = 0) => {
      const indent = '  '.repeat(level);
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tagName = node.tagName.toLowerCase();
        let attrs = '';
        for (let attr of node.attributes) {
          attrs += ` ${attr.name}="${Convert.escapeHTML(attr.value)}"`;
        }

        const selfClosing = ['br', 'img', 'hr'].includes(tagName);
        if (selfClosing) {
          return `<${tagName}${attrs}>`;
        }

        const isBlock = ['h1', 'h2', 'h3', 'p', 'ul', 'ol', 'li', 'pre', 'blockquote'].includes(tagName);
        const hasBlock = hasBlockChildren(node);

        if (hasBlock) {
          let childrenStr = '';
          for (let child of node.childNodes) {
            if (child.nodeType === Node.TEXT_NODE && !child.textContent.trim()) {
              continue;
            }
            const childStr = formatHTMLNode(child, level + 1);
            childrenStr += `\n${indent}  ${childStr.trim()}`;
          }
          return `<${tagName}${attrs}>${childrenStr}\n${indent}</${tagName}>`;
        } else {
          let childrenStr = '';
          for (let child of node.childNodes) {
            childrenStr += formatHTMLNode(child, level + 1);
          }
          if (isBlock) {
            childrenStr = childrenStr.trim();
          }
          return `<${tagName}${attrs}>${childrenStr}</${tagName}>`;
        }
      }
      return '';
    };

    let formatted = '';
    for (let child of div.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && !child.textContent.trim()) {
        continue;
      }
      const str = formatHTMLNode(child, 0);
      if (str.trim()) {
        formatted += str.trim() + '\n';
      }
    }
    return formatted.trim();
  },

  highlightHTML(html) {
    if (!html) return '';
    const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let result = '';
    let index = 0;
    const tokenRegex =
      /(<!--[\s\S]*?-->)|(<[\/]?[a-zA-Z0-9:-]+(?:\s+[a-zA-Z0-9:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*[\/]?>)/g;

    let match;
    while ((match = tokenRegex.exec(html)) !== null) {
      if (match.index > index) {
        result += escape(html.substring(index, match.index));
      }

      const comment = match[1];
      const tag = match[2];

      if (comment) {
        result += `<span class="hljs-comment">${escape(comment)}</span>`;
      } else if (tag) {
        const tagMatch = tag.match(/^(<\/?)([a-zA-Z0-9:-]+)([\s\S]*?)(\/?>)$/);
        if (tagMatch) {
          const start = tagMatch[1];
          const tagName = tagMatch[2];
          const attrsPart = tagMatch[3];
          const end = tagMatch[4];

          let highlightedAttrs = '';
          const attrRegex = /([a-zA-Z0-9:-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
          let attrMatch;
          let attrIndex = 0;
          while ((attrMatch = attrRegex.exec(attrsPart)) !== null) {
            if (attrMatch.index > attrIndex) {
              highlightedAttrs += escape(attrsPart.substring(attrIndex, attrMatch.index));
            }
            const attrName = attrMatch[1];
            const attrVal = attrMatch[2];
            highlightedAttrs += `<span class="hljs-attr">${escape(attrName)}</span>`;
            if (attrVal) {
              highlightedAttrs += `=<span class="hljs-string">${escape(attrVal)}</span>`;
            }
            attrIndex = attrRegex.lastIndex;
          }
          if (attrIndex < attrsPart.length) {
            highlightedAttrs += escape(attrsPart.substring(attrIndex));
          }
          result += `<span class="hljs-tag">${escape(start)}<span class="hljs-name">${escape(tagName)}</span>${highlightedAttrs}${escape(end)}</span>`;
        } else {
          result += `<span class="hljs-tag">${escape(tag)}</span>`;
        }
      }
      index = tokenRegex.lastIndex;
    }

    if (index < html.length) {
      result += escape(html.substring(index));
    }
    return result;
  },

  textToParagraphs(text) {
    if (!text) return '';
    if (text.includes('<p>') || text.includes('</p>')) {
      return text;
    }
    const paragraphs = text.split(/\r?\n\r?\n+/);
    return paragraphs
      .map((p) => {
        const clean = p.trim().replace(/\r?\n/g, '<br>');
        if (!clean) return '';
        return `<p>${clean}</p>`;
      })
      .filter((p) => p !== '')
      .join('');
  },

  htmlToStructuredText(html) {
    if (!html) return '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const temp = doc.body;

    // Clean remove buttons and locks
    temp.querySelectorAll('.kai-remove-btn').forEach((btn) => btn.remove());

    // Iterate through child nodes or block elements: h1, h2, h3, p, h4, blockquote
    const lines = [];
    const elements = temp.querySelectorAll('h1, h2, h3, p, h4, blockquote');

    elements.forEach((el) => {
      const tagName = el.tagName.toLowerCase();
      const text = el.textContent.replace(/🔒/g, '').trim();
      if (!text) return; // skip empty text elements

      if (tagName === 'h1') {
        lines.push(`[TITULO DEL LIBRO (h1)]: "${text}" (Esta línea es el título principal del libro)`);
      } else if (tagName === 'h2') {
        lines.push(`[CAPITULO (h2)]: "${text}" (Esta línea representa el título de un capítulo del libro)`);
      } else if (tagName === 'h3') {
        lines.push(`[TEMA DEL CAPITULO (h3)]: "${text}" (Esta línea representa un subtema del capítulo)`);
      } else if (tagName === 'h4') {
        lines.push(`[ACOTACION (h4)]: (${text})`);
      } else if (tagName === 'blockquote') {
        lines.push(`[DIALOGO (blockquote)]: "${text}"`);
      } else if (tagName === 'p') {
        lines.push(`[PARRAFO (p)]: ${text}`);
      }
    });

    if (lines.length === 0) {
      const text = temp.innerText || temp.textContent || '';
      return text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `[PARRAFO (p)]: ${line}`)
        .join('\n');
    }

    return lines.join('\n');
  },
};
