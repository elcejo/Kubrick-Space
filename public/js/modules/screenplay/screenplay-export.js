import { parseScreenplayContent, screenplayToHTML } from './screenplay-document.js';
import { escapeHTML } from '../../safe-html.js';

export const SCREENPLAY_PRINT_CSS = `@page{size:A4;margin:25mm 20mm 25mm 30mm}body{font-family:"Courier New",monospace;font-size:12pt;line-height:1.1;color:#111;margin:0}h1{font-size:16pt;text-align:center;margin:0 0 24pt}h2{font-size:12pt;text-transform:uppercase;margin:18pt 0 12pt;break-after:avoid;page-break-after:avoid}p{margin:0 0 12pt}h3{font-size:12pt;font-weight:normal;text-transform:uppercase;margin:12pt 0 0 40%;break-after:avoid;page-break-after:avoid}blockquote{margin:0 15% 12pt 20%;padding:0;border:0}h4{font-size:12pt;font-weight:normal;margin:0 20% 0 28%;break-after:avoid;page-break-after:avoid}h5{font-size:12pt;font-weight:normal;text-align:right;margin:12pt 0}h2,h3,h4,p,blockquote{orphans:2;widows:2}tag{font-weight:inherit}span.kai-tag{color:inherit}`;

export function screenplayPrintDocument(content, name) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHTML(name)}</title><style>${SCREENPLAY_PRINT_CSS}</style></head><body>${screenplayToHTML(parseScreenplayContent(content))}</body></html>`;
}

const xml = (value) =>
  String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(
      /[<>&"']/g,
      (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char],
    );
const encoder = new TextEncoder();
const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
/** Small uncompressed ZIP writer for the three required OpenXML parts. */
function zip(entries) {
  const local = [],
    central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const filename = encoder.encode(name),
      body = encoder.encode(text),
      crc = crc32(body);
    const header = new Uint8Array(30 + filename.length),
      h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true);
    h.setUint16(12, 0x21, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, body.length, true);
    h.setUint32(22, body.length, true);
    h.setUint16(26, filename.length, true);
    header.set(filename, 30);
    local.push(header, body);
    const directory = new Uint8Array(46 + filename.length),
      d = new DataView(directory.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x0800, true);
    d.setUint16(14, 0x21, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, body.length, true);
    d.setUint32(24, body.length, true);
    d.setUint16(28, filename.length, true);
    d.setUint32(42, offset, true);
    directory.set(filename, 46);
    central.push(directory);
    offset += header.length + body.length;
  }
  const end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, central.length, true);
  e.setUint16(10, central.length, true);
  e.setUint32(
    12,
    central.reduce((n, v) => n + v.length, 0),
    true,
  );
  e.setUint32(16, offset, true);
  return new Blob([...local, ...central, end], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

/** Native DOCX paragraphs and runs; no HTML document hidden behind a DOCX extension. */
export function screenplayDocx(content) {
  const doc = parseScreenplayContent(content);
  const runs = (html) => {
    const root = new DOMParser().parseFromString(html, 'text/html').body;
    const visit = (node, format = {}) => {
      if (node.nodeType === 3)
        return `<w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="24"/>${format.bold ? '<w:b/>' : ''}${format.italic ? '<w:i/>' : ''}${format.underline ? '<w:u w:val="single"/>' : ''}${format.color ? `<w:color w:val="${format.color}"/>` : ''}</w:rPr><w:t xml:space="preserve">${xml(node.textContent)}</w:t></w:r>`;
      if (node.nodeName === 'BR') return '<w:r><w:br/></w:r>';
      const next = {
        ...format,
        bold: format.bold || ['B', 'STRONG'].includes(node.nodeName),
        italic: format.italic || ['I', 'EM'].includes(node.nodeName),
        underline: format.underline || node.nodeName === 'U',
      };
      const color = node.style?.color || node.getAttribute?.('color');
      if (color) {
        const hex = color.match(/^#([\da-f]{6})$/i);
        const rgb = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
        if (hex) next.color = hex[1];
        else if (rgb)
          next.color = rgb
            .slice(1)
            .map((v) => Number(v).toString(16).padStart(2, '0'))
            .join('');
      }
      return [...node.childNodes].map((child) => visit(child, next)).join('');
    };
    return visit(root);
  };
  const paragraph = (type, html) => {
    const indent =
      type === 'character'
        ? '<w:ind w:left="3600"/>'
        : type === 'dialogue'
          ? '<w:ind w:left="1800" w:right="1440"/>'
          : type === 'parenthetical'
            ? '<w:ind w:left="2400" w:right="1800"/>'
            : '';
    const align = type === 'title' ? 'center' : type === 'transition' ? 'right' : 'left';
    return `<w:p><w:pPr>${indent}<w:jc w:val="${align}"/><w:spacing w:after="${['character', 'parenthetical'].includes(type) ? 0 : 240}" w:line="240" w:lineRule="auto"/><w:widowControl/>${['scene', 'character', 'parenthetical'].includes(type) ? '<w:keepNext/>' : ''}</w:pPr>${runs(html)}</w:p>`;
  };
  const body =
    paragraph('title', doc.title.html || xml(doc.title.text)) +
    doc.preamble.map((b) => paragraph(b.type, b.html || xml(b.text))).join('') +
    doc.scenes
      .map(
        (s) =>
          paragraph('scene', s.heading.html || xml(s.heading.text)) +
          s.blocks.map((b) => paragraph(b.type, b.html || xml(b.text))).join(''),
      )
      .join('');
  return zip({
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1134" w:bottom="1417" w:left="1701"/></w:sectPr></w:body></w:document>`,
  });
}
