/** Text the assistant shows for a book-to-screenplay adaptation job (CK-SCRIPT-018). */
const clock = (minutes) => {
  const total = Math.round(minutes);
  return total >= 60
    ? Math.floor(total / 60) + ' h ' + String(total % 60).padStart(2, '0') + ' min'
    : total + ' min';
};

/** The plan, as soon as it exists: size, length on screen and what each unit is for (Markdown, like every bubble). */
export function adaptationPlanMessage(plan) {
  if (!plan?.units) return '';
  const shown = plan.items.slice(0, 12).map((item) => {
    const place = item.chapter ? '«' + item.chapter + '» · ' : '';
    return item.unit + '. ' + place + clock(item.minutes) + (item.intent ? ' — ' + item.intent : '');
  });
  const more = plan.items.length - shown.length;
  const notes = String(plan.notes || '').trim();
  const verb = plan.update ? 'Plan de actualización: ' : 'Plan de adaptación: ';
  return [
    verb +
      plan.units +
      (plan.units === 1 ? ' unidad' : ' unidades') +
      ', unos ' +
      clock(plan.minutes) +
      ' de pantalla.',
    notes ? 'Tono: ' + (notes.length > 280 ? notes.slice(0, 277).trimEnd() + '…' : notes) : '',
    shown.join('\n') + (more > 0 ? '\n… y ' + more + ' más.' : ''),
    'Cada unidad se guarda al terminar; puedes pulsar Stop y seguir después.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The closing message of a finished adaptation job. */
export function adaptationDoneMessage(job) {
  const result = job.result || {};
  if (result.mode === 'update') {
    if (!result.units) return result.message || 'El guión ya está al día con el libro.';
    return (
      'Guión actualizado: ' +
      (result.added || 0) +
      ((result.added || 0) === 1 ? ' escena nueva' : ' escenas nuevas') +
      ', ' +
      (result.removed || 0) +
      ((result.removed || 0) === 1 ? ' retirada' : ' retiradas') +
      '; el resto quedó intacto. Ahora tiene ' +
      result.scenes +
      ' escenas, unos ' +
      clock(result.minutes) +
      '. Está guardado en el borrador.' +
      (result.warnings || []).map((warning) => '\n• ' + warning).join('')
    );
  }
  const warnings = (result.warnings || []).map((warning) => '\n• ' + warning).join('');
  return (
    'Guión generado: ' +
    result.scenes +
    (result.scenes === 1 ? ' escena' : ' escenas') +
    ', unos ' +
    clock(result.minutes) +
    ', desde ' +
    result.units +
    (result.units === 1 ? ' unidad' : ' unidades') +
    ' del libro. Está guardado en el borrador.' +
    warnings
  );
}
