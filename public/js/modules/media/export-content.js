import { escapeHTML } from '../../safe-html.js';

export function productionHTML(project) {
  const p = project.production || {};
  const paragraph = (text) => '<p>' + escapeHTML(text || '').replace(/\n/g, '<br>') + '</p>';
  const scenes = p.scenes || [];
  return (
    '<h1>' +
    escapeHTML(project.name) +
    '</h1>' +
    '<p>Plan audiovisual · ' +
    scenes.length +
    ' escenas · ' +
    scenes.reduce((sum, scene) => sum + (scene.duration || 0), 0) +
    ' segundos</p>' +
    (p.scriptProjectName ? '<h2>Guión vinculado</h2>' + paragraph(p.scriptProjectName) : '') +
    scenes
      .map(
        (scene, index) =>
          '<section><h2>' +
          (index + 1) +
          '. ' +
          escapeHTML(scene.title) +
          '</h2><p>Duración: ' +
          (scene.duration === null ? 'sin definir' : scene.duration + ' s') +
          ' · ' +
          escapeHTML(scene.status) +
          '</p>' +
          paragraph(scene.script) +
          (scene.prompt ? '<h3>Prompt</h3>' + paragraph(scene.prompt) : '') +
          (scene.shots?.length
            ? '<h3>Planos y clips</h3>' +
              scene.shots
                .map(
                  (shot) =>
                    '<h4>' +
                    escapeHTML(shot.title) +
                    '</h4>' +
                    paragraph(shot.prompt) +
                    paragraph(shot.duration === null ? 'Duración sin definir' : shot.duration + ' s'),
                )
                .join('')
            : '') +
          '</section>',
      )
      .join('') +
    (!scenes.length ? '<p>No hay escenas todavía.</p>' : '') +
    (p.voiceover ? '<h2>Voz en off</h2>' + paragraph(p.voiceover) : '') +
    (p.soundtrack ? '<h2>Referencia musical</h2>' + paragraph(p.soundtrack) : '') +
    (p.styles?.length ? '<h2>Tratamiento visual</h2>' + paragraph(p.styles.join(', ')) : '') +
    (Object.values(p.vfx || {}).some(Boolean)
      ? '<h2>Efectos</h2>' +
        paragraph(
          Object.keys(p.vfx)
            .filter((key) => p.vfx[key])
            .join(', '),
        )
      : '')
  );
}

export async function imageToPNG(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('No se pudo decodificar el retrato.'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo convertir la imagen a PNG.');
    context.drawImage(image, 0, 0);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('No se pudo codificar el PNG.'))),
        'image/png',
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
