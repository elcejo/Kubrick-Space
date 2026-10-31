import { renderIcon } from '../../icons.js';
import { isCreatableProject } from '../../contracts/project-availability.js';
/**
 * @file m-video.js — Video Module for Kubrick Space
 * @description Defines the "Video / Película" content type: subcategories, ingredients, export formats, sidebar config.
 * @module m-video
 */

/**
 * Video module definition.
 * @type {import('./app.js').ModuleDefinition}
 */
export default {
  /** Unique module identifier */
  type: 'video',

  /** Human-readable label */
  label: 'Metraje',

  /** SVG icon (stroke-based, 24 × 24 viewBox) */
  icon: renderIcon('video', 32),

  /** Available subcategories shown in wizard step 2 */
  subcategories: [
    {
      id: 'short-film',
      comingSoon: !isCreatableProject('video', 'short-film'),
      label: 'Cortometraje',
      description: 'Piezas narrativas de menos de 30 min',
      icon: 'video',
    },
    {
      id: 'feature',
      comingSoon: !isCreatableProject('video', 'feature'),
      label: 'Largometraje',
      description: 'Películas de larga duración',
      icon: 'video',
    },
    {
      id: 'documentary',
      comingSoon: !isCreatableProject('video', 'documentary'),
      label: 'Documental',
      description: 'No ficción, entrevistas, archivo',
      icon: 'camera',
    },
    {
      id: 'music-video',
      comingSoon: !isCreatableProject('video', 'music-video'),
      label: 'Videoclip Musical',
      description: 'Visual para acompañar una canción',
      icon: 'music',
    },
    {
      id: 'animation',
      comingSoon: !isCreatableProject('video', 'animation'),
      label: 'Animación',
      description: '2D, 3D o motion graphics',
      icon: 'brush',
    },
  ],

  /** Supported export formats */
  exportFormats: [
    { id: 'mp4', label: 'MP4', extension: '.mp4' },
    { id: 'mov', label: 'MOV', extension: '.mov' },
    { id: 'script-pdf', label: 'Script PDF', extension: '.pdf' },
  ],

  /** Ingredient types available in the left sidebar */
  ingredients: [
    { type: 'book', label: 'Guión (proyecto)', icon: 'book', description: 'Guión del que nacen las escenas' },
    {
      type: 'character',
      label: 'Personaje',
      icon: 'character',
      description: 'Personajes que aparecen en pantalla',
    },
    { type: 'stage', label: 'Escenario', icon: 'stage', description: 'Locaciones y continuidad visual' },
    { type: 'script', label: 'Guión', icon: 'document', description: 'Guión literario y técnico' },
    { type: 'storyboard', label: 'Storyboard', icon: 'brush', description: 'Secuencia visual de planos' },
    { type: 'media', label: 'Material de rodaje', icon: 'image', description: 'Clips, fotos de set, assets' },
  ],

  /**
   * Return the sidebar tab configuration for the workspace.
   * @returns {{ tabs: Array<{ id: string, label: string, icon: string }> }}
   */
  getSidebarConfig() {
    return {
      tabs: [
        { id: 'ingredients', label: 'Ingredientes', icon: 'ingredients' },
        { id: 'timeline', label: 'Timeline', icon: 'video' },
        { id: 'generate', label: 'Generación', icon: 'agent' },
      ],
    };
  },
};
