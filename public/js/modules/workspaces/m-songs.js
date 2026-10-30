import { renderIcon } from '../../icons.js';
/**
 * @file m-songs.js — Song Module for Kubrick Space
 * @description Defines the "Canción" content type: subcategories, ingredients, export formats, sidebar config.
 * @module m-songs
 */

/**
 * Song module definition.
 * @type {import('./app.js').ModuleDefinition}
 */
export default {
  /** Unique module identifier */
  type: 'song',

  /** Human-readable label */
  label: 'Música',

  /** SVG icon (stroke-based, 24 × 24 viewBox) */
  icon: renderIcon('song', 32),

  /** Available subcategories shown in wizard step 2 */
  subcategories: [
    { id: 'single', label: 'Single', description: 'Sencillo musical independiente', icon: 'music' },
    { id: 'album', label: 'Álbum', description: 'Colección de canciones', icon: 'disc' },
    { id: 'soundtrack', label: 'Soundtrack', description: 'Banda sonora', icon: 'video' },
  ],

  /** Supported export formats */
  exportFormats: [
    { id: 'mp3', label: 'MP3', extension: '.mp3' },
    { id: 'wav', label: 'WAV', extension: '.wav' },
    { id: 'midi', label: 'MIDI', extension: '.mid' },
  ],

  /** Ingredient types available in the left sidebar */
  ingredients: [
    { type: 'lyrics', label: 'Letra', icon: 'document', description: 'Versos, coros y estructura lírica' },
    {
      type: 'mood',
      label: 'Mood / Estilo',
      icon: 'mask',
      description: 'Tono emocional y referencias de estilo',
    },
    {
      type: 'media',
      label: 'Audio de referencia',
      icon: 'headphones',
      description: 'Samples, demos, inspiraciones',
    },
  ],

  /**
   * Return the sidebar tab configuration for the workspace.
   * @returns {{ tabs: Array<{ id: string, label: string, icon: string }> }}
   */
  getSidebarConfig() {
    return {
      tabs: [
        { id: 'ingredients', label: 'Ingredientes', icon: 'ingredients' },
        { id: 'arrangement', label: 'Arreglo', icon: 'score' },
        { id: 'generate', label: 'Generación', icon: 'agent' },
      ],
    };
  },
};
