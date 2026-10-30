import { renderIcon } from '../../icons.js';
/**
 * @file m-stages.js — Stage Module for Kubrick Space
 * @description Defines the "Escenario" content type: subcategories, ingredients, export formats, sidebar config.
 * @module m-stages
 */

/**
 * Stage module definition.
 * @type {import('./app.js').ModuleDefinition}
 */
export default {
  /** Unique module identifier */
  type: 'stage',

  /** Human-readable label */
  label: 'Escenario',

  /** SVG icon (stroke-based, 24 × 24 viewBox) */
  icon: renderIcon('stage', 32),

  /** Available subcategories shown in wizard step 2 */
  subcategories: [
    { id: 'interior', label: 'Interior', description: 'Espacio cerrado o techado', icon: 'home' },
    { id: 'exterior', label: 'Exterior', description: 'Espacio abierto o al aire libre', icon: 'tree' },
  ],

  /** Supported export formats */
  exportFormats: [
    { id: 'pdf', label: 'PDF', extension: '.pdf' },
    { id: 'png', label: 'PNG Image', extension: '.png' },
  ],

  /** Ingredient types available in the left sidebar */
  ingredients: [
    { type: 'book', label: 'Libro', icon: 'book', description: 'Historia a la que pertenece' },
    { type: 'character', label: 'Personaje', icon: 'character', description: 'Personajes frecuentes aquí' },
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
