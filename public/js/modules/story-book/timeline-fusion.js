import { renderIcon } from '../../icons.js';
import { safeHTML } from '../../safe-html.js';

const NS = 'http://www.w3.org/2000/svg';
const number = (value) => value.toFixed(3);
const element = (tag, attributes = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
};

/** Equal-radius concave arcs meet a circular port and a straight cable tangentially. */
export function timelinePortNeck(radius, halfWidth) {
  if (!(radius > halfWidth && halfWidth > 0)) return { length: 0, path: '' };
  const length = Math.sqrt(4 * radius * radius - (radius + halfWidth) ** 2);
  const x = length / 2;
  const y = (radius + halfWidth) / 2;
  return {
    radius,
    halfWidth,
    x,
    y,
    length,
    path: `M 0 0 L ${number(x)} ${number(-y)} A ${radius} ${radius} 0 0 0 ${number(length)} ${-halfWidth} L ${number(length)} ${halfWidth} A ${radius} ${radius} 0 0 0 ${number(x)} ${number(y)} Z`,
  };
}

/** Straight necks precede the spline, so its tangent cannot cut through the join. */
export function timelineCableGeometry(source, target, sourceRadius = 0, targetRadius = 0) {
  const direction = target.x >= source.x ? 1 : -1;
  const distance = Math.abs(target.x - source.x);
  const sourceLength = Math.min(timelinePortNeck(sourceRadius, 1.1).length, distance / 3);
  const targetLength = Math.min(timelinePortNeck(targetRadius, 1.1).length, distance / 3);
  const start = { x: source.x + direction * sourceLength, y: source.y };
  const end = { x: target.x - direction * targetLength, y: target.y };
  const curve = Math.max(36, Math.abs(end.x - start.x) * 0.45);
  const one = { x: start.x + direction * curve, y: start.y };
  const two = { x: end.x - direction * curve, y: end.y };
  return {
    source,
    target,
    direction,
    sourceLength,
    targetLength,
    pathData: `M ${number(source.x)} ${number(source.y)} L ${number(start.x)} ${number(start.y)} C ${number(one.x)} ${number(one.y)}, ${number(two.x)} ${number(two.y)}, ${number(end.x)} ${number(end.y)} L ${number(target.x)} ${number(target.y)}`,
    midpoint: {
      x: (start.x + 3 * one.x + 3 * two.x + end.x) / 8,
      y: (start.y + 3 * one.y + 3 * two.y + end.y) / 8,
    },
  };
}

/** One decorative port per live DOM anchor, even when several cables share it. */
export function createTimelineFusion({ svg, defs, toPoint, scaleX, scaleY, spine, viewport }) {
  const ports = new Map();
  let gradientIndex = 0;
  const gradient = (from, to, colors) => {
    const id = `timeline-fusion-gradient-${gradientIndex++}`;
    const node = element('linearGradient', {
      id,
      gradientUnits: 'userSpaceOnUse',
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
    });
    for (const [offset, color] of colors) node.append(element('stop', { offset, 'stop-color': color }));
    defs.append(node);
    return `url(#${id})`;
  };
  const port = (anchor) => {
    if (ports.has(anchor)) return ports.get(anchor);
    const rect = anchor.getBoundingClientRect();
    const radius = Math.min(rect.width / scaleX, rect.height / scaleY) / 2;
    if (!(radius > 0)) return null;
    const record = {
      center: toPoint(rect),
      radius,
      color: anchor.ownerDocument.defaultView.getComputedStyle(anchor).color || '#60d9ff',
      necks: new Map(),
    };
    ports.set(anchor, record);
    return record;
  };
  const neck = (record, angle, halfWidth, fill, length = null) => {
    const shape = timelinePortNeck(record.radius, halfWidth);
    if (!shape.length) return;
    record.necks.set(angle, { ...shape, angle, fill, scale: length === null ? 1 : length / shape.length });
  };
  // Match the existing CSS spine's stops without moving or re-spacing any entry.
  const spineRect = spine?.getBoundingClientRect();
  const spineColor = (screenY) => {
    const fraction = Math.max(0, Math.min(1, (screenY - spineRect.top) / spineRect.height));
    const stops = [
      [0, [34, 211, 238]],
      [0.42, [79, 140, 255]],
      [1, [168, 85, 247]],
    ];
    const index = fraction <= 0.42 ? 0 : 1;
    const [a, first] = stops[index],
      [b, last] = stops[index + 1];
    const ratio = (fraction - a) / (b - a);
    return `rgb(${first.map((value, i) => Math.round(value + (last[i] - value) * ratio)).join(' ')})`;
  };
  return {
    port,
    rail(anchor) {
      if (!spineRect?.height) return;
      const rect = anchor.getBoundingClientRect();
      const center = toPoint(rect);
      const axis = toPoint(spineRect).x;
      if (Math.abs(center.x - axis) > 2 || rect.bottom <= viewport.top || rect.top >= viewport.bottom) return;
      const record = port(anchor);
      if (!record) return;
      const shape = timelinePortNeck(record.radius, 1.5);
      for (const direction of [-1, 1]) {
        const end = { x: center.x, y: center.y + direction * shape.length };
        // Do not paint beyond the scroll viewport at either end of the track.
        if (
          rect.top + rect.height / 2 + direction * shape.length * scaleY < viewport.top ||
          rect.top + rect.height / 2 + direction * shape.length * scaleY > viewport.bottom
        )
          continue;
        const fill = gradient(center, end, [
          ['0%', record.color],
          ['100%', spineColor(rect.top + rect.height / 2 + direction * shape.length * scaleY)],
        ]);
        neck(record, direction * 90, 1.5, fill);
      }
    },
    cable(sourceAnchor, targetAnchor, geometry) {
      const source = sourceAnchor ? port(sourceAnchor) : null;
      const target = targetAnchor ? port(targetAnchor) : null;
      const start = source?.center || geometry.source;
      const end = target?.center || geometry.target;
      const fill = gradient({ x: start.x, y: 0 }, { x: end.x, y: 0 }, [
        ['0%', source?.color || '#a855f7'],
        ['50%', '#60a5fa'],
        ['100%', target?.color || '#22d3ee'],
      ]);
      if (source) neck(source, geometry.direction === 1 ? 0 : 180, 1.1, fill, geometry.sourceLength);
      if (target) neck(target, geometry.direction === 1 ? 180 : 0, 1.1, fill, geometry.targetLength);
      return fill;
    },
    flush() {
      const layer = element('g', {
        class: 'story-book-timeline-fusion',
        'aria-hidden': 'true',
        'pointer-events': 'none',
      });
      for (const record of ports.values()) {
        const group = element('g', {
          color: record.color,
          'data-timeline-fusion-x': record.center.x,
          'data-timeline-fusion-y': record.center.y,
          'data-timeline-fusion-radius': record.radius,
        });
        for (const join of record.necks.values()) {
          const radians = (join.angle * Math.PI) / 180;
          const point = (x, y) =>
            `${number(record.center.x + Math.cos(radians) * x * join.scale - Math.sin(radians) * y)} ${number(record.center.y + Math.sin(radians) * x * join.scale + Math.cos(radians) * y)}`;
          const arc = `${join.radius * join.scale} ${join.radius} ${join.angle} 0 0`;
          const path = `M ${point(0, 0)} L ${point(join.x, -join.y)} A ${arc} ${point(join.length, -join.halfWidth)} L ${point(join.length, join.halfWidth)} A ${arc} ${point(join.x, join.y)} Z`;
          if (join.scale > 0)
            group.append(
              element('path', { class: 'story-book-timeline-fusion__neck', d: path, fill: join.fill }),
            );
        }
        const icon = element('g', {
          transform: `translate(${record.center.x - record.radius} ${record.center.y - record.radius}) scale(${record.radius / 12})`,
        });
        icon.innerHTML = safeHTML(renderIcon('timeline-port', 24));
        group.append(icon);
        layer.append(group);
      }
      svg.append(layer);
      return new Set(ports.keys());
    },
  };
}
