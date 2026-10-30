import { renderIcon } from '../../icons.js';
/**
 * @file m-characters.js — Character Module for Kubrick Space
 * @description Defines the "Personaje" content type: subcategories, ingredients, export formats, sidebar config.
 * @module m-characters
 */

/**
 * Character module definition.
 * @type {import('./app.js').ModuleDefinition}
 */
export default {
  /** Unique module identifier */
  type: 'character',

  /** Human-readable label */
  label: 'Personaje',

  /** SVG icon (stroke-based, 24 × 24 viewBox) */
  icon: renderIcon('character', 32),

  /** Available subcategories shown in wizard step 2 */
  subcategories: [
    {
      id: 'protagonist',
      label: 'Protagonista',
      description: 'Personaje principal de la historia',
      icon: 'shield',
    },
    {
      id: 'antagonist',
      label: 'Antagonista',
      description: 'Oponente principal del protagonista',
      icon: 'mask',
    },
    {
      id: 'secondary',
      label: 'Secundario',
      description: 'Personaje de soporte en la trama',
      icon: 'character',
    },
  ],

  /** Supported export formats */
  exportFormats: [
    { id: 'pdf-sheet', label: 'Ficha del personaje (PDF)', extension: '.pdf' },
    { id: 'png-card', label: 'Retrato (PNG)', extension: '.png' },
  ],

  /** Ingredient types available in the left sidebar */
  ingredients: [
    {
      type: 'backstory',
      label: 'Libro',
      icon: 'book',
      description: 'Libro en el que participa o se le menciona',
    },
    { type: 'character', label: 'Personaje', icon: 'character', description: 'Personajes relacionados' },
    {
      type: 'definition',
      label: 'Definición',
      icon: 'tag',
      description: 'Definición de vocabulario o glosario',
    },
  ],

  /**
   * Return the sidebar tab configuration for the workspace.
   * @returns {{ tabs: Array<{ id: string, label: string, icon: string }> }}
   */
  getSidebarConfig() {
    return {
      tabs: [{ id: 'ingredients', label: 'Ingredientes', icon: 'ingredients' }],
    };
  },
};
