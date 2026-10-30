import { renderIcon } from '../../icons.js';
/**
 * @file m-books.js — Book Module for Kubrick Space
 * @description Defines the "Libro" content type: subcategories, ingredients, export formats, sidebar config.
 * @module m-books
 */

/**
 * Book module definition.
 * @type {import('./app.js').ModuleDefinition}
 */
export default {
  /** Unique module identifier */
  type: 'book',

  /** Human-readable label */
  label: 'Libro',

  /** SVG icon (stroke-based, 24 × 24 viewBox) */
  icon: renderIcon('book', 32),

  /** Available subcategories shown in wizard step 2 */
  subcategories: [
    { id: 'story-book', label: 'Story Book', description: 'Narrativa y ficción', icon: 'book' },
    {
      id: 'screenplay',
      label: 'Guión Cinematográfico',
      description: 'Formato de guión para cine',
      icon: 'video',
    },
  ],

  /** Supported export formats */
  exportFormats: [
    { id: 'pdf', label: 'PDF', extension: '.pdf' },
    { id: 'docx', label: 'Word', extension: '.docx' },
    { id: 'md', label: 'Markdown', extension: '.md' },
  ],

  /** Ingredient types available in the left sidebar */
  ingredients: [
    { type: 'character', label: 'Personaje', icon: 'character', description: 'Perfiles de personajes' },
    { type: 'book', label: 'Libro', icon: 'book', description: 'Otros libros relacionados o de referencia' },
    { type: 'definition', label: 'Definición', icon: 'tag', description: 'Definición de término especial' },
    { type: 'stage', label: 'Escenario', icon: 'stage', description: 'Locaciones y continuidad visual' },
  ],

  /**
   * Return the sidebar tab configuration for the workspace.
   * @returns {{ tabs: Array<{ id: string, label: string, icon: string }> }}
   */
  getSidebarConfig() {
    return {
      tabs: [
        { id: 'ingredients', label: 'Ingredientes', icon: 'ingredients' },
        { id: 'format', label: 'Formato', icon: 'edit' },
        { id: 'generate', label: 'Generación', icon: 'agent' },
      ],
    };
  },
};
