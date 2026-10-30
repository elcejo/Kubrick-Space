import { Mode } from '../../contracts/editor-mode.js';
import { canMoveNarrativeBlock } from '../../contracts/narrative-operations.js';

import {
  ensureStoryBookRows,
  storyBookRow,
  storyBookHeading,
  storyBookBlockFromTarget,
  deleteStoryBookParagraph,
  captureStoryBookSelection,
  restoreStoryBookSelection,
  navigateStoryBookSelection,
  replaceStoryBookCrossRowSelection,
} from './story-book-rows.js';

/** Feature-owned editing operations; the host supplies only explicit integration ports. */
export class StoryBookEditing {
  collapsedStoryNodes = new Set();
  storyTreeSurfaces = new WeakSet();
  constructor(context) {
    this.context = context;
  }
  destroy() {
    this.collapsedStoryNodes.clear();
  }
  prepareStoryBookTree(container) {
    if (!container || !this.context.isStoryBook()) return;
    this.ensureStoryBookElementIds();
    const blockTags = new Set(['P', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'H4']);
    const directNodes = [...container.childNodes];
    const fragment = document.createDocumentFragment();
    let chapter = null;
    let theme = null;

    const makeToggle = (label) => {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'story-book-tree-toggle';
      toggle.contentEditable = 'false';
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', `Colapsar ${label}`);
      return toggle;
    };
    const addHeadingToggle = (heading, kind) => {
      heading.querySelectorAll(':scope > .story-book-tree-toggle').forEach((node) => node.remove());
      heading.insertBefore(
        makeToggle(
          heading.textContent.replace(/\s+/g, ' ').trim() || (kind === 'chapter' ? 'Capítulo' : 'Tema'),
        ),
        heading.firstChild,
      );
    };
    const makeContent = (owner) => {
      const content = document.createElement('div');
      content.className = 'story-book-tree-content';
      content.contentEditable = 'false';
      owner.appendChild(content);
      return content;
    };
    const makeHeading = (tag, text, idPrefix) => {
      const heading = document.createElement(tag);
      heading.textContent = text;
      heading.dataset.kaiId = `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
      return heading;
    };
    const ensureChapter = () => {
      if (chapter) return chapter;
      chapter = document.createElement('div');
      chapter.className = 'story-book-tree-chapter';
      chapter.dataset.storyTreeNode = 'chapter';
      chapter.dataset.storyImplicit = 'true';
      makeContent(chapter);
      fragment.appendChild(chapter);
      theme = null;
      return chapter;
    };
    const ensureTheme = () => {
      ensureChapter();
      if (theme) return theme;
      theme = document.createElement('div');
      theme.className = 'story-book-tree-theme';
      theme.dataset.storyTreeNode = 'theme';
      theme.dataset.storyImplicit = 'true';
      makeContent(theme);
      chapter.querySelector(':scope > .story-book-tree-content').appendChild(theme);
      return theme;
    };
    const appendBlock = (node) => {
      const target = ensureTheme().querySelector(':scope > .story-book-tree-content');
      target.appendChild(node);
    };

    directNodes.forEach((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) {
        if (node.textContent.trim()) {
          const paragraph = document.createElement('p');
          paragraph.textContent = node.textContent.trim();
          appendBlock(paragraph);
        }
        return;
      }
      const element = /** @type {HTMLElement} */ (node);
      if (element.tagName === 'H1') {
        fragment.appendChild(element);
      } else if (element.tagName === 'H2') {
        chapter = document.createElement('div');
        chapter.className = 'story-book-tree-chapter';
        chapter.dataset.storyTreeNode = 'chapter';
        addHeadingToggle(element, 'chapter');
        chapter.appendChild(element);
        makeContent(chapter);
        fragment.appendChild(chapter);
        theme = null;
      } else if (element.tagName === 'H3') {
        ensureChapter();
        theme = document.createElement('div');
        theme.className = 'story-book-tree-theme';
        theme.dataset.storyTreeNode = 'theme';
        addHeadingToggle(element, 'theme');
        theme.appendChild(element);
        makeContent(theme);
        chapter.querySelector(':scope > .story-book-tree-content').appendChild(theme);
      } else if (blockTags.has(element.tagName)) {
        appendBlock(element);
      } else if (element.textContent.trim()) {
        const paragraph = document.createElement('p');
        paragraph.textContent = element.textContent.trim();
        appendBlock(paragraph);
      }
    });

    // Empty or legacy content still needs a usable writing target.
    if (!fragment.querySelector('h1')) {
      const title = makeHeading('h1', 'Título', 'title');
      fragment.insertBefore(title, fragment.firstChild);
    }
    if (!fragment.querySelector('.story-book-tree-chapter')) ensureChapter();
    container.replaceChildren(fragment);
    container.contentEditable = 'false';
    ensureStoryBookRows(container);
    this.ensureStoryBookDragHandles(container);
    this.context.ensureStoryBookTimelinePorts(container);

    container.querySelectorAll('.story-book-tree-chapter, .story-book-tree-theme').forEach((group) => {
      const heading = storyBookHeading(group);
      const content = group.querySelector(':scope > .story-book-tree-content');
      const id = heading?.dataset.kaiId;
      const collapsed = Boolean(id && this.collapsedStoryNodes.has(id));
      group.classList.toggle('is-collapsed', collapsed);
      group.draggable = false;
      if (content) content.hidden = collapsed;
      const toggle = storyBookRow(heading)?.querySelector('.story-book-tree-toggle');
      const dragHandle = storyBookRow(heading)?.querySelector('.story-book-tree-drag-handle');
      if (dragHandle)
        dragHandle.draggable =
          dragHandle.dataset.storyDragKind === 'chapter' ||
          (group.classList.contains('story-book-tree-theme') && collapsed);
      if (toggle) {
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.setAttribute(
          'aria-label',
          `${collapsed ? 'Expandir' : 'Colapsar'} ${heading.textContent.replace(/\s+/g, ' ').trim()}`,
        );
      }
    });

    // Reconciliation replaces children, while delegated listeners remain on the surface.
    if (this.storyTreeSurfaces.has(container)) {
      this.context.syncStoryBookTimelineVisualState();
      return;
    }
    this.storyTreeSurfaces.add(container);
    const replaceCrossSelection = (text) => {
      const selection = window.getSelection();
      if (!selection?.rangeCount) return false;
      const caret = replaceStoryBookCrossRowSelection(container, selection.getRangeAt(0), text);
      if (!caret) return false;
      selection.removeAllRanges();
      selection.addRange(caret);
      this.context.emitChange();
      return true;
    };
    container.addEventListener('beforeinput', (event) => {
      if (event.inputType === 'insertText' && replaceCrossSelection(event.data || '')) event.preventDefault();
    });
    container.addEventListener('paste', (event) => {
      if (replaceCrossSelection(event.clipboardData.getData('text/plain'))) event.preventDefault();
    });
    container.addEventListener('cut', (event) => {
      const text = window.getSelection()?.toString() || '';
      if (replaceCrossSelection('')) {
        event.clipboardData.setData('text/plain', text);
        event.preventDefault();
      }
    });
    container.addEventListener('click', (event) => {
      const toggle = event.target.closest('.story-book-tree-toggle');
      if (!toggle || !container.contains(toggle)) return;
      event.preventDefault();
      event.stopPropagation();
      const group = toggle.closest('.story-book-tree-chapter, .story-book-tree-theme');
      const content = group?.querySelector(':scope > .story-book-tree-content');
      const heading = storyBookHeading(group);
      if (!group || !content || !heading) return;
      const collapsed = !group.classList.contains('is-collapsed');
      group.classList.toggle('is-collapsed', collapsed);
      group.draggable = false;
      content.hidden = collapsed;
      const dragHandle = storyBookRow(heading).querySelector('.story-book-tree-drag-handle');
      if (dragHandle)
        dragHandle.draggable =
          dragHandle.dataset.storyDragKind === 'chapter' ||
          (group.classList.contains('story-book-tree-theme') && collapsed);
      const id = heading.dataset.kaiId;
      if (id) {
        if (collapsed) this.collapsedStoryNodes.add(id);
        else this.collapsedStoryNodes.delete(id);
      }
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute(
        'aria-label',
        `${collapsed ? 'Expandir' : 'Colapsar'} ${heading.textContent.replace(/\s+/g, ' ').trim()}`,
      );
      this.context.timeline.requestGeometryRefresh();
    });
    container.addEventListener('dragstart', (event) => {
      const target = event.target;
      const port = target.closest?.('.story-book-node-port');
      if (port && container.contains(port)) {
        const node = port.closest('[data-story-node-id]');
        if (!node?.dataset.storyNodeId || !node.dataset.storyNodeType) return;
        const payload = JSON.stringify({
          side: 'editor',
          nodeId: node.dataset.storyNodeId,
          nodeType: node.dataset.storyNodeType,
          port: port.dataset.port || 'out',
        });
        event.dataTransfer?.setData('application/x-kubrick-space-timeline-link', payload);
        event.dataTransfer?.setData('text/plain', payload);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'link';
        node.classList.add('is-link-dragging');
        this.context.beginStoryBookTimelineDrag({
          side: 'editor',
          nodeId: node.dataset.storyNodeId,
          nodeType: node.dataset.storyNodeType,
        });
        return;
      }
      const handle = target.closest?.('.story-book-tree-drag-handle');
      if (!handle || !container.contains(handle)) return;
      const dragKind = handle.dataset.storyDragKind;
      if (dragKind === 'chapter') {
        const chapterGroup = handle.closest('.story-book-tree-chapter');
        if (!chapterGroup) return;
        event.dataTransfer?.setData('application/x-kubrick-space-story-node', 'chapter');
        event.dataTransfer?.setData(
          'text/plain',
          `chapter:${storyBookHeading(chapterGroup)?.dataset.kaiId || ''}`,
        );
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        chapterGroup.classList.add('is-dragging');
        return;
      }
      const block = storyBookBlockFromTarget(target);
      const themeGroup = handle.closest?.('.story-book-tree-theme');
      if (block && container.contains(block) && !block.closest('h2, h3')) {
        event.dataTransfer?.setData('application/x-kubrick-space-story-node', 'paragraph');
        event.dataTransfer?.setData('text/plain', `paragraph:${block.dataset.kaiId || ''}`);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        block.classList.add('is-dragging');
      } else if (
        themeGroup &&
        container.contains(themeGroup) &&
        themeGroup.classList.contains('is-collapsed')
      ) {
        const heading = storyBookHeading(themeGroup);
        event.dataTransfer?.setData('application/x-kubrick-space-story-node', 'theme');
        event.dataTransfer?.setData('text/plain', `theme:${heading?.dataset.kaiId || ''}`);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        themeGroup.classList.add('is-dragging');
      }
    });
    container.addEventListener('dragend', (event) => {
      event.target.closest?.('.is-dragging')?.classList.remove('is-dragging');
      event.target.closest?.('.is-link-dragging')?.classList.remove('is-link-dragging');
      this.context.clearStoryBookTimelineDragPreview();
    });
    container.addEventListener('drag', (event) => this.context.updateStoryBookTimelineDragPreview(event));
    container.addEventListener('dragover', (event) => {
      const isTimelineLink = event.dataTransfer?.types?.includes('application/x-kubrick-space-timeline-link');
      if (isTimelineLink) {
        event.stopPropagation();
        if (this.context.timeline.storyNodeForDrop(event.target)) event.preventDefault();
        return;
      }
      const isStoryDrag = event.dataTransfer?.types?.includes('application/x-kubrick-space-story-node');
      if (!isStoryDrag) return;
      event.stopPropagation();
      const block = storyBookBlockFromTarget(event.target);
      const themeGroup = event.target.closest?.('.story-book-tree-theme.is-collapsed');
      const chapterGroup = event.target.closest?.('.story-book-tree-chapter');
      if (block || themeGroup || chapterGroup) event.preventDefault();
    });
    container.addEventListener('drop', (event) => {
      const isTimelineLink = event.dataTransfer?.types?.includes('application/x-kubrick-space-timeline-link');
      if (isTimelineLink) {
        event.stopPropagation();
        event.preventDefault();
        this.context.handleStoryBookTimelineLinkDrop(event);
        return;
      }
      const isStoryDrag = event.dataTransfer?.types?.includes('application/x-kubrick-space-story-node');
      if (!isStoryDrag) return;
      event.stopPropagation();
      event.preventDefault();
      const value = event.dataTransfer?.getData('text/plain') || '';
      const [kind, sourceId] = value.split(':');
      if (!sourceId) return;
      const targetBlock = storyBookBlockFromTarget(event.target);
      const targetTheme = event.target.closest?.('.story-book-tree-theme.is-collapsed');
      const targetChapter = event.target.closest?.('.story-book-tree-chapter');
      if (kind === 'chapter' && targetChapter) {
        const sourceHeading = this.findStoryElement(sourceId);
        const sourceChapter = sourceHeading?.closest('.story-book-tree-chapter');
        if (sourceChapter && sourceChapter !== targetChapter && !sourceChapter.contains(targetChapter)) {
          const placeAfter =
            event.clientY >
            targetChapter.getBoundingClientRect().top + targetChapter.getBoundingClientRect().height / 2;
          targetChapter.parentNode.insertBefore(
            sourceChapter,
            placeAfter ? targetChapter.nextSibling : targetChapter,
          );
          this.context.emitChange();
        }
      } else if (
        kind === 'paragraph' &&
        targetBlock &&
        !targetBlock.matches('h1,h2,h3') &&
        canMoveNarrativeBlock(kind, sourceId, targetBlock.dataset.kaiId)
      ) {
        const source = this.findStoryElement(sourceId);
        if (source && source !== targetBlock) {
          const placeAfter =
            event.clientY >
            targetBlock.getBoundingClientRect().top + targetBlock.getBoundingClientRect().height / 2;
          const targetRow = storyBookRow(targetBlock);
          targetRow.parentNode.insertBefore(
            storyBookRow(source),
            placeAfter ? targetRow.nextSibling : targetRow,
          );
          this.context.emitChange();
        }
      } else if (kind === 'theme' && targetTheme) {
        const sourceHeading = this.findStoryElement(sourceId);
        const sourceTheme = sourceHeading?.closest('.story-book-tree-theme');
        if (sourceTheme && sourceTheme !== targetTheme && !sourceTheme.contains(targetTheme)) {
          const placeAfter =
            event.clientY >
            targetTheme.getBoundingClientRect().top + targetTheme.getBoundingClientRect().height / 2;
          targetTheme.parentNode.insertBefore(
            sourceTheme,
            placeAfter ? targetTheme.nextSibling : targetTheme,
          );
          this.context.emitChange();
        }
      }
    });
    this.context.syncStoryBookTimelineVisualState();
  }
  ensureStoryBookDragHandles(container = this.context.surface) {
    if (!container || !this.context.isStoryBook() || this.context.mode !== Mode.WYSIWYG) return;
    ensureStoryBookRows(container);
    const createHandle = (label, kind) => {
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'story-book-tree-drag-handle';
      handle.contentEditable = 'false';
      handle.draggable = true;
      handle.dataset.storyDragKind = kind;
      handle.setAttribute('aria-label', label);
      handle.title = label;
      handle.addEventListener('click', (event) => event.preventDefault());
      return handle;
    };

    container.querySelectorAll('.story-book-row').forEach((row) => {
      const kind = row.dataset.storyRowKind;
      if (kind === 'title') return;
      const host = row.querySelector(':scope > .story-book-row__drag');
      let handle = host.querySelector('.story-book-tree-drag-handle');
      if (!handle) {
        handle = createHandle(
          kind === 'chapter'
            ? 'Arrastrar capítulo'
            : kind === 'theme'
              ? 'Arrastrar tema colapsado'
              : 'Arrastrar párrafo',
          kind,
        );
        host.append(handle);
      }
      handle.draggable = kind !== 'theme' || Boolean(row.closest('.story-book-tree-theme.is-collapsed'));
    });
  }
  storyBookStructuralId(headingId, nodeType) {
    if (!headingId || !this.context.storyBookDocument) return headingId;
    if (nodeType === 'chapter') {
      return (
        this.context.storyBookDocument.chapters.find((chapter) => chapter.title?.id === headingId)?.id ||
        headingId
      );
    }
    if (nodeType === 'theme') {
      for (const chapter of this.context.storyBookDocument.chapters || []) {
        const theme = (chapter.themes || []).find((item) => item.title?.id === headingId);
        if (theme) return theme.id;
      }
    }
    return headingId;
  }
  updateIndex() {
    const isStoryBook = this.context.isStoryBook();
    if (!isStoryBook) return;
    if (!this.context.indexNode || !this.context.surface) return;

    this.ensureStoryBookElementIds();
    this.context.indexNode.replaceChildren();
    const headings = [...this.context.surface.querySelectorAll('h1, h2, h3')].filter((element) =>
      element.textContent.replace(/\s+/g, ' ').trim(),
    );
    if (!headings.length) {
      this.context.indexNode.classList.add('is-hidden');
      return;
    }
    this.context.indexNode.classList.remove('is-hidden');

    const headerLabel = document.createElement('div');
    headerLabel.className = 'index-header-label';
    headerLabel.textContent = 'Índice del libro';
    this.context.indexNode.appendChild(headerLabel);

    const wrapper = document.createElement('div');
    wrapper.className = 'index-content-wrapper';
    const scrollTo = (element) => {
      if (!element || !this.context.surface) return;
      element.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      if (!element.scrollIntoView)
        this.context.surface.scrollTo({ top: Math.max(0, element.offsetTop - 16), behavior: 'smooth' });
    };
    headings.forEach((element) => {
      const tag = element.tagName.toLowerCase();
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `index-item index-item--${tag}`;
      row.textContent = element.textContent.replace(/[🔒×]/g, '').replace(/\s+/g, ' ').trim();
      row.addEventListener('click', () => scrollTo(element));
      wrapper.appendChild(row);
    });
    this.context.indexNode.appendChild(wrapper);
  }
  ensureStoryBookElementIds() {
    if (!this.context.surface) return;
    const allowed = new Set(['H1', 'H2', 'H3', 'H4', 'P', 'BLOCKQUOTE', 'PRE', 'UL', 'OL']);
    const seen = new Set();
    [...this.context.surface.querySelectorAll('h1,h2,h3,h4,p,blockquote,pre,ul,ol')].forEach((element) => {
      if (!allowed.has(element.tagName)) return;
      let id = element.dataset.kaiId;
      if (!id || seen.has(id)) {
        id = `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
        element.dataset.kaiId = id;
      }
      seen.add(id);
    });
  }
  findStoryElement(id) {
    if (!this.context.surface || !id) return null;
    return (
      [...this.context.surface.querySelectorAll('[data-kai-id]')].find(
        (element) => element.dataset.kaiId === id,
      ) || null
    );
  }
  storyBookEditingBlockFromNode(node) {
    if (!node || !this.context.surface) return null;
    let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (element && element !== this.context.surface) {
      if (element.matches?.('p, blockquote, pre, h4')) return element;
      element = element.parentElement;
    }
    return null;
  }
  storyBookEditableText(block) {
    if (!block) return '';
    const clone = block.cloneNode(true);
    clone
      .querySelectorAll(
        '.story-book-tree-drag-handle, .story-book-node-port, .story-book-tree-toggle, .kai-remove-btn, br',
      )
      .forEach((node) => node.remove());
    return (clone.textContent || '').replace(/\u200b/g, '').trim();
  }
  placeStoryBookCaret(block, atEnd = false) {
    if (block && !this.context.surface?.contains(block)) block = this.findStoryElement(block.dataset.kaiId);
    if (!block || !block.isConnected) return;
    const selection = window.getSelection();
    if (!selection) return;
    block.focus({ preventScroll: true });

    const controls = new Set(
      [...block.children].filter((child) =>
        child.matches?.(
          '.story-book-tree-drag-handle, .story-book-node-port, .story-book-tree-toggle, .kai-remove-btn',
        ),
      ),
    );
    const children = [...block.childNodes];
    const editable = children.filter((node) => !controls.has(node));
    const range = document.createRange();

    if (!editable.length) {
      const text = document.createTextNode('');
      block.appendChild(text);
      range.setStart(text, 0);
      range.collapse(true);
    } else {
      const target = atEnd ? editable[editable.length - 1] : editable[0];
      const index = children.indexOf(target);
      if (target.nodeType === Node.TEXT_NODE) {
        range.setStart(target, atEnd ? target.textContent.length : 0);
        range.collapse(true);
      } else if (target.nodeName === 'BR') {
        range.setStart(block, atEnd ? index + 1 : index);
        range.collapse(true);
      } else {
        range.selectNodeContents(target);
        range.collapse(!atEnd);
      }
    }

    selection.removeAllRanges();
    selection.addRange(range);
  }
  deleteEmptyStoryBookParagraph(e) {
    if (!this.context.isStoryBook() || this.context.mode !== Mode.WYSIWYG) return false;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
    const block = this.storyBookEditingBlockFromNode(selection.anchorNode);
    if (!block || block.tagName !== 'P' || this.storyBookEditableText(block)) return false;
    if (block.querySelector('img, video, audio, canvas, svg')) return false;

    const paragraphs = [...this.context.surface.querySelectorAll('p')];
    const index = paragraphs.indexOf(block);
    const previous = index > 0 ? paragraphs[index - 1] : null;
    if (!previous) return false;

    e.preventDefault();
    storyBookRow(block).remove();
    this.ensureStoryBookDragHandles();
    this.context.ensureStoryBookTimelinePorts();
    this.placeStoryBookCaret(previous, true);
    this.context.emitChange();
    return true;
  }
  removeStoryBookParagraph(id) {
    if (this.context.destroyed || !this.context.isStoryBook() || this.context.mode !== Mode.WYSIWYG) return;
    const result = deleteStoryBookParagraph(this.context.surface, id);
    if (!result) return;
    this.context.emitChange();
    const destination = this.findStoryElement(result.focusId);
    if (destination) this.placeStoryBookCaret(destination, result.atEnd);
  }
  handleStoryBookRowKey(e) {
    if (!this.context.isStoryBook() || this.context.mode !== Mode.WYSIWYG || e.isComposing) return false;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return false;
    let range = selection.getRangeAt(0);
    const start =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer
        : range.startContainer.parentElement;
    const block = start?.closest('.story-book-row__text');
    if (!block || !this.context.surface.contains(block)) return false;
    const row = storyBookRow(block);
    if (
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !selection.isCollapsed &&
      (e.key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(e.key))
    ) {
      const caret = replaceStoryBookCrossRowSelection(
        this.context.surface,
        range,
        e.key.length === 1 ? e.key : '',
      );
      if (caret) {
        selection.removeAllRanges();
        selection.addRange(caret);
        if (e.key !== 'Enter') {
          e.preventDefault();
          this.context.emitChange();
          return true;
        }
        range = caret;
      }
    }
    if (
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.shiftKey &&
      selection.isCollapsed &&
      navigateStoryBookSelection(this.context.surface, block, range, e.key)
    ) {
      e.preventDefault();
      return true;
    }
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !start.closest('li') &&
      (document.getElementById('kai-mention-popup')?.hidden ?? true)
    ) {
      if (!block.contains(range.endContainer)) return false;
      e.preventDefault();
      range.deleteContents();
      const tail = document.createRange();
      tail.selectNodeContents(block);
      tail.setStart(range.startContainer, range.startOffset);
      const paragraph = document.createElement('p');
      paragraph.dataset.kaiId = `node-${crypto.randomUUID()}`;
      paragraph.append(tail.extractContents());
      if (!paragraph.childNodes.length) paragraph.append(document.createElement('br'));
      if (!block.childNodes.length) block.append(document.createElement('br'));
      if (block.matches('h1,h2,h3')) {
        const owner = block.matches('h1')
          ? this.context.surface.querySelector('.story-book-tree-theme')
          : row.closest('.story-book-tree-theme') ||
            row.closest('.story-book-tree-chapter')?.querySelector('.story-book-tree-theme');
        const content = owner?.querySelector(':scope > .story-book-tree-content');
        if (content) content.prepend(paragraph);
        else row.after(paragraph);
      } else row.after(paragraph);
      this.context.emitChange();
      this.placeStoryBookCaret(paragraph);
      return true;
    }
    if (
      !['Backspace', 'Delete'].includes(e.key) ||
      e.ctrlKey ||
      e.metaKey ||
      !selection.isCollapsed ||
      block.tagName !== 'P'
    )
      return false;
    const boundary = document.createRange();
    boundary.selectNodeContents(block);
    if (e.key === 'Backspace') boundary.setEnd(range.startContainer, range.startOffset);
    else boundary.setStart(range.startContainer, range.startOffset);
    if (boundary.toString().length || boundary.cloneContents().querySelector('img,video,audio')) return false;
    const neighbourRow = e.key === 'Backspace' ? row.previousElementSibling : row.nextElementSibling;
    const neighbour = neighbourRow?.querySelector(':scope > p.story-book-row__text');
    if (!neighbour) return false;
    e.preventDefault();
    const destination = e.key === 'Backspace' ? neighbour : block;
    const source = e.key === 'Backspace' ? block : neighbour;
    if (!this.storyBookEditableText(destination)) destination.replaceChildren();
    const caret = document.createRange();
    const offset = destination.childNodes.length;
    destination.append(...source.childNodes);
    storyBookRow(source).remove();
    this.context.emitChange();
    destination.focus({ preventScroll: true });
    caret.setStart(destination, Math.min(offset, destination.childNodes.length));
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
    return true;
  }
  formatBlocks(tagName, range) {
    const saved = captureStoryBookSelection(this.context.surface);
    const blocks = [...this.context.surface.querySelectorAll('.story-book-row__text')].filter(
      (block) => block.tagName !== 'H1' && range.intersectsNode(block),
    );
    blocks.forEach((block) => {
      const replacement = document.createElement(tagName);
      for (const attribute of block.attributes) replacement.setAttribute(attribute.name, attribute.value);
      replacement.append(...block.childNodes);
      block.replaceWith(replacement);
    });
    restoreStoryBookSelection(this.context.surface, saved);
  }
}
