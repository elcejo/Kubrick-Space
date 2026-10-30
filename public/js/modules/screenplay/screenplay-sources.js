import { API } from '../../api-service.js';
import { enhanceSelect } from '../../custom-select.js';
import { versionDialog } from '../ingredients/ingredient-version-dialogs.js';
import { parseStoryBookContent } from '../story-book/story-book-document.js';

export function bookElements(content) {
  const doc = parseStoryBookContent(content);
  const structured = String(content).includes('code-kai.story-book');
  return [
    doc.title,
    ...doc.chapters.flatMap((chapter) => [
      { ...chapter.title, id: chapter.id },
      ...chapter.themes.flatMap((theme) => [{ ...theme.title, id: theme.id }, ...theme.paragraphs]),
    ]),
  ]
    .filter((item) => item.text?.trim())
    .map((item, index) => ({ id: structured ? item.id : `legacy-element-${index}`, text: item.text }));
}

export function bookOrigin(book, elementIds = []) {
  return {
    projectId: book.importedProjectId,
    source: book.importedSource || 'legacy',
    ...(book.importedSource === 'version'
      ? { versionId: book.importedVersionId, versionNumber: book.importedVersionNumber }
      : {}),
    elementIds,
  };
}

export async function chooseStoryBook(ingredients, cleanups, isCurrent = () => true) {
  const books = [];
  for (const ingredient of ingredients.filter(
    (item) => item.type === 'book' && item.active !== false && item.importedProjectId,
  )) {
    const project = await API.getProject(ingredient.importedProjectId);
    if (!isCurrent()) return null;
    if (project.type === 'book' && project.category === 'story-book') books.push(ingredient);
  }
  if (!books.length) throw new Error('Vincula y activa un Story Book como fuente.');
  if (books.length === 1) return books[0];
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Libro de origen');
  for (const book of books) {
    const option = document.createElement('option');
    option.value = book.importedProjectId;
    option.textContent =
      (book.importedProjectName || book.label) +
      (book.importedVersionNumber ? ` · Versión ${book.importedVersionNumber}` : '');
    select.append(option);
  }
  const content = document.createElement('div');
  content.append(select);
  let control;
  const pending = versionDialog({
    title: 'Elegir libro de origen',
    content,
    cleanups,
    initialFocus: '.kai-select__trigger',
    dispose: () => control?.destroy({ restore: false }),
    options: [
      { label: 'Cancelar', value: null },
      {
        label: 'Usar libro',
        primary: true,
        value: () => books.find((book) => book.importedProjectId === select.value),
      },
    ],
  });
  control = enhanceSelect(select);
  return pending;
}

export async function selectedBookContent(book) {
  if (book.importedSource !== 'version') return book.value || '';
  const version = await API.getDocumentVersion(book.importedProjectId, book.importedVersionId);
  if (!version?.snapshot) throw new Error('La versión elegida ya no está disponible.');
  return version.snapshot.content || '';
}

export async function editSceneOrigin(scene, ingredients, cleanups, isCurrent = () => true) {
  const book = await chooseStoryBook(ingredients, cleanups, isCurrent);
  if (!book) return null;
  const content = document.createElement('div');
  content.className = 'screenplay-source-elements';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Buscar fragmento';
  search.setAttribute('aria-label', 'Buscar elementos del libro');
  const list = document.createElement('div');
  list.className = 'screenplay-source-elements__list';
  const selected = new Set(
    scene.origins?.find(
      (origin) => origin.projectId === book.importedProjectId && origin.versionId === book.importedVersionId,
    )?.elementIds || [],
  );
  const items = bookElements(await selectedBookContent(book));
  if (!isCurrent()) return null;
  for (const item of items) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = selected.has(item.id);
    const text = document.createElement('span');
    text.textContent = item.text.slice(0, 240);
    input.addEventListener('change', () =>
      input.checked ? selected.add(item.id) : selected.delete(item.id),
    );
    label.append(input, text);
    list.append(label);
  }
  search.addEventListener('input', () => {
    for (const label of list.children)
      label.hidden = !label.textContent.toLocaleLowerCase().includes(search.value.toLocaleLowerCase());
  });
  content.append(search, list);
  return versionDialog({
    title: 'Origen de la escena',
    content,
    cleanups,
    initialFocus: 'input[type="search"]',
    options: [
      { label: 'Cancelar', value: null },
      { label: 'Vincular origen', primary: true, value: () => bookOrigin(book, [...selected]) },
    ],
  });
}
