import { parseStoryBookContent, storyBookDocumentToHTML } from '../story-book/story-book-document.js';
import { parseScreenplayContent, screenplayToHTML } from '../screenplay/screenplay-document.js';
import { renderScreenplayComparison } from '../screenplay/screenplay-comparison.js';
import { parseCharacterDocument } from '../characters/character-model.js';
import { characterDocumentToHTML } from '../characters/character-workspace.js';
import { safeHTML } from '../../safe-html.js';

/** Compose read-only version adapters; documents only owns version loading and revisions. */
export function versionPresentation(project) {
  return {
    compare: project.category === 'screenplay' ? renderScreenplayComparison : null,
    render(body, content) {
      let schema;
      try {
        schema = JSON.parse(content)?.schema;
      } catch {
        /* Legacy HTML. */
      }
      if (project.category === 'story-book' || schema === 'code-kai.story-book')
        body.innerHTML = safeHTML(storyBookDocumentToHTML(parseStoryBookContent(content)));
      else if (project.category === 'screenplay' || schema === 'code-kai.screenplay') {
        body.className = 'screenplay-preview';
        body.innerHTML = safeHTML(screenplayToHTML(parseScreenplayContent(content)));
      } else if (schema === 'code-kai.character')
        body.innerHTML = safeHTML(characterDocumentToHTML(parseCharacterDocument(content)));
      else if (content.trim().startsWith('{')) {
        const pre = document.createElement('pre');
        try {
          pre.textContent = JSON.stringify(JSON.parse(content), null, 2);
        } catch {
          pre.textContent = content;
        }
        body.appendChild(pre);
      } else body.innerHTML = safeHTML(content);
    },
  };
}
