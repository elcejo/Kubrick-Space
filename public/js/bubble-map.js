import { renderIcon } from './icons.js';
import { safeHTML, escapeHTML } from './safe-html.js';
/**
 * @file bubble-map.js — Interactive project bubble map visualizer for Kubrick Space
 * @description Renders projects as draggable glassmorphism bubbles with forces and connections.
 * @module bubble-map
 */

export class BubbleMap {
  constructor(canvasContainerId, svgId, nodesContainerId) {
    this.container = document.getElementById(canvasContainerId);
    this.svg = d3.select(`#${svgId}`);
    this.nodesContainer = document.getElementById(nodesContainerId);
    this.simulation = null;
    this.nodesData = [];
    this.linksData = [];
    this.resizeObserver = null;
    this.contextMenu = null;
  }

  /**
   * Initialize the bubble map simulation.
   * @param {Array} projects — AppState.projects
   * @param {Function} onOpenProject — Callback to open a project by ID
   * @param {Function} onDeleteProject — Callback to delete a project by ID
   */
  init(projects, onOpenProject, onDeleteProject) {
    if (!this.container || !projects || projects.length === 0) return;

    this.destroy(); // Ensure any previous simulation is cleaned up

    this.nodesContainer.innerHTML = safeHTML('');
    this.svg.selectAll('*').remove();

    this.nodesData = [];
    this.linksData = [];

    // 1. Process project sizes (radius proportional to content size)
    const minRadius = 38;
    const maxRadius = 75;

    const sizesWithContent = projects.map((p) => (p.content || '').length).filter((len) => len > 0);

    const minSize = sizesWithContent.length > 0 ? Math.min(...sizesWithContent) : 0;
    const maxSize = sizesWithContent.length > 0 ? Math.max(...sizesWithContent) : 1;

    const width = this.container.clientWidth || 500;
    const height = this.container.clientHeight || 400;

    this.nodesData = projects.map((p) => {
      const size = (p.content || '').length;
      let radius = minRadius;
      if (size === 0) {
        radius = minRadius;
      } else if (maxSize !== minSize) {
        // Logarithmic scale for better visual variance without exploding sizes relative to min/max
        const logSize = Math.log(size + 1);
        const logMin = Math.log(minSize + 1);
        const logMax = Math.log(maxSize + 1);
        const ratio = Math.max(0, Math.min(1, (logSize - logMin) / (logMax - logMin)));
        radius = minRadius + ratio * (maxRadius - minRadius);
      } else {
        radius = (minRadius + maxRadius) / 2;
      }
      return {
        ...p,
        radius,
        // D3 simulation coordinates initialized near the center of the container
        x: width / 2 + (Math.random() - 0.5) * 150,
        y: height / 2 + (Math.random() - 0.5) * 150,
      };
    });

    // 2. Build Links (connections) between nodes (connected if ingredients are shared)
    const projectIds = new Set(projects.map((p) => p.id));
    const linksSet = new Set();

    projects.forEach((p) => {
      p.ingredients?.forEach((ing) => {
        if (ing.importedProjectId && projectIds.has(ing.importedProjectId)) {
          const targetId = ing.importedProjectId;
          const key = [p.id, targetId].sort().join('-');
          if (!linksSet.has(key)) {
            linksSet.add(key);
            this.linksData.push({
              source: p.id,
              target: targetId,
            });
          }
        }
      });
    });

    // 3. Setup D3 Force Simulation
    this.simulation = d3
      .forceSimulation(this.nodesData)
      .force(
        'link',
        d3
          .forceLink(this.linksData)
          .id((d) => d.id)
          .distance((d) => d.source.radius + d.target.radius + 70),
      )
      .force('charge', d3.forceManyBody().strength(-220)) // repulsion to avoid clusters sticking too close
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force(
        'collision',
        d3
          .forceCollide()
          .radius((d) => d.radius + 15)
          .iterations(4),
      )
      .velocityDecay(0.35); // damping for organic, floating feel

    // 4. Render visual links and bubbles
    this.render(onOpenProject, onDeleteProject);

    // 5. Watch for container resize to update force center
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.container || !this.simulation) return;
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      this.simulation.force('center', d3.forceCenter(w / 2, h / 2));
      this.simulation.alpha(0.3).restart();
    });
    this.resizeObserver.observe(this.container);
  }

  /**
   * Create SVG links and HTML bubble divs.
   */
  render(onOpenProject, onDeleteProject) {
    const self = this;

    // Render connection lines
    const defs = this.svg.append('defs');

    this.linksData.forEach((d) => {
      const gradId = `grad-${d.source.id}-${d.target.id}`;
      defs.select(`#${gradId}`).remove();

      const grad = defs.append('linearGradient').attr('id', gradId).attr('gradientUnits', 'userSpaceOnUse');

      grad.append('stop').attr('offset', '0%').attr('stop-color', self.getBorderColor(d.source.type));

      grad.append('stop').attr('offset', '100%').attr('stop-color', self.getBorderColor(d.target.type));
    });

    const linkElements = this.svg
      .append('g')
      .attr('class', 'bubble-map-links')
      .selectAll('line')
      .data(this.linksData)
      .enter()
      .append('line')
      .attr('class', 'bubble-link')
      .attr('stroke', (d) => `url(#grad-${d.source.id}-${d.target.id})`)
      .attr('stroke-width', 2.5)
      .attr('stroke-opacity', 0.65);

    // Render HTML Nodes (positioned absolutely via left/top on tick)
    const nodeElements = d3
      .select(this.nodesContainer)
      .selectAll('.bubble-node')
      .data(this.nodesData)
      .enter()
      .append('div')
      .attr('class', 'bubble-node absolute cursor-grab select-none')
      .attr('role', 'button')
      .attr('tabindex', '0')
      .attr('data-project-id', (d) => d.id)
      .attr('aria-label', (d) => `Seleccionar ${d.name || 'Sin título'}`)
      .attr('title', (d) => d.name || 'Sin título')
      .style('width', (d) => `${d.radius * 2}px`)
      .style('height', (d) => `${d.radius * 2}px`)
      .html((d) => {
        // Retrieve covers
        let imgUrl = '';
        let mainCover = '';
        if (typeof d.previewImage === 'string') {
          mainCover = d.previewImage;
          imgUrl = d.previewFaceImage || mainCover;
        } else if (d.covers && d.covers.length > 0) {
          const index =
            d.currentCoverIndex >= 0 && d.currentCoverIndex < d.covers.length ? d.currentCoverIndex : 0;
          mainCover = d.covers[index];
          if (d.type === 'character') {
            const lastDot = mainCover.lastIndexOf('.');
            if (lastDot !== -1) {
              imgUrl = mainCover.substring(0, lastDot) + '-face' + mainCover.substring(lastDot);
            } else {
              imgUrl = mainCover + '-face.png';
            }
          } else {
            imgUrl = mainCover;
          }
        }

        // Category styling details
        const borderColor = self.getBorderColor(d.type);

        let fallbackIcon = '📂';
        if (d.type === 'book') fallbackIcon = '📖';
        else if (d.type === 'character') fallbackIcon = '👤';
        else if (d.type === 'song') fallbackIcon = '🎵';
        else if (d.type === 'video') fallbackIcon = '🎬';
        else if (d.type === 'stage') fallbackIcon = '🏔️';

        return safeHTML(`
          <div class="bubble-circle w-full h-full rounded-full border-[3px] relative flex items-center justify-center overflow-hidden transition-all duration-300 hover:scale-105 hover:rotate-3" 
               style="--bubble-color: ${borderColor};">
            ${
              imgUrl
                ? `
              <img src="${escapeHTML(imgUrl)}" alt="" class="absolute inset-0 w-full h-full object-cover pointer-events-none z-0" 
                   data-fallback="${escapeHTML(mainCover)}" />
              <div class="absolute inset-0 bg-black/15 pointer-events-none z-10"></div>
              <span class="bubble-icon-span is-hidden text-2xl pointer-events-none z-20 select-none">${renderIcon(fallbackIcon, 32)}</span>
            `
                : `
              <span class="bubble-icon-span text-2xl pointer-events-none z-20 select-none">${renderIcon(fallbackIcon, 32)}</span>
            `
            }
          </div>
          <div class="bubble-label absolute pointer-events-none text-center bg-black/80 backdrop-blur-md px-2 py-0.5 rounded border border-white/10 text-[10px] font-semibold text-white truncate max-w-[110px]">
            ${escapeHTML(d.name || 'Sin título')}
          </div>
        `);
      });

    // Handle dragging with collision restart prevention
    let isDragging = false;
    let dragStartCoords = { x: 0, y: 0 };

    const dragBehavior = d3
      .drag()
      .on('start', (event, d) => {
        if (!event.active) self.simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
        dragStartCoords = { x: event.x, y: event.y };
        isDragging = false;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
        // Distinguish drag from micro-movements
        const dx = event.x - dragStartCoords.x;
        const dy = event.y - dragStartCoords.y;
        if (Math.sqrt(dx * dx + dy * dy) > 5) {
          isDragging = true;
        }
      })
      .on('end', (event, d) => {
        if (!event.active) self.simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    nodeElements.call(dragBehavior);

    // Bind actions
    nodeElements.each(function (d) {
      const el = this;

      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenProject(d.id);
        }
      });

      // Click event
      el.addEventListener('click', (e) => {
        // Prevent click if we were dragging
        if (isDragging) return;
        onOpenProject(d.id);
      });

      // Context menu event
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        self.showContextMenu(e.clientX, e.clientY, d.id, d.name, onDeleteProject);
      });
    });

    // 5. Update coordinates on tick
    this.simulation.on('tick', () => {
      // Keep selectable nodes and their labels inside the visible map.
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      this.nodesData.forEach((d) => {
        d.x = Math.max(d.radius + 8, Math.min(width - d.radius - 8, d.x));
        d.y = Math.max(d.radius + 8, Math.min(height - d.radius - 42, d.y));
      });
      // Update gradient coordinates
      this.linksData.forEach((d) => {
        defs
          .select(`#grad-${d.source.id}-${d.target.id}`)
          .attr('x1', d.source.x)
          .attr('y1', d.source.y)
          .attr('x2', d.target.x)
          .attr('y2', d.target.y);
      });

      // Update link line positions
      linkElements
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);

      // Update node div positions
      nodeElements.style('left', (d) => `${d.x - d.radius}px`).style('top', (d) => `${d.y - d.radius}px`);
    });
  }

  /**
   * Display custom context menu at client coords.
   */
  showContextMenu(x, y, projectId, projectName, onDeleteProject) {
    const self = this;
    this.hideContextMenu();

    const menu = document.createElement('div');
    menu.id = 'bubble-context-menu';
    menu.className = 'glass-heavy bubble-map-context-menu animate-scaleIn';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    menu.innerHTML = safeHTML(`
      <button class="menu-item bubble-map-context-action">
        <span>${renderIcon('trash')}</span> Eliminar Proyecto
      </button>
    `);

    document.body.appendChild(menu);
    this.contextMenu = menu;

    // Trigger delete action
    menu.querySelector('button').addEventListener('click', (e) => {
      e.stopPropagation();
      self.hideContextMenu();
      onDeleteProject(projectId, projectName);
    });

    // Click outside to close
    const closeMenu = () => {
      self.hideContextMenu();
      document.removeEventListener('click', closeMenu);
    };
    setTimeout(() => {
      document.addEventListener('click', closeMenu);
    }, 50);
  }

  hideContextMenu() {
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
  }

  /**
   * Get border colors based on project subcategories.
   */
  getBorderColor(subcategory) {
    const colors = {
      book: '#e6b877',
      character: '#ac9cf7',
      stage: '#77cdb9',
      video: '#83b8ef',
      song: '#df9abc',
      // Books
      'story-book': '#f97316', // Orange
      screenplay: '#ef4444', // Red

      // Characters
      protagonist: '#a78bfa', // Violet
      secondary: '#38bdf8', // Sky Blue
      custom: '#64748b', // Slate

      // Stages (Escenarios)
      interior: '#2dd4bf', // Teal
      exterior: '#4ade80', // Green

      // Songs (Canciones)
      original: '#ec4899', // Pink
      cover: '#f43f5e', // Rose
      instrumental: '#10b981', // Emerald
      remix: '#84cc16', // Lime

      // Video
      'short-film': '#3b82f6', // Blue
      feature: '#6366f1', // Indigo
      documentary: '#06b6d4', // Cyan
      'music-video': '#d946ef', // Fuchsia
      animation: '#eab308', // Yellow
    };
    return colors[subcategory] || '#6366f1';
  }

  /**
   * Clean up simulation and resize observer on unmount.
   */
  destroy() {
    if (this.simulation) {
      this.simulation.stop();
      this.simulation = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.hideContextMenu();
  }
}
