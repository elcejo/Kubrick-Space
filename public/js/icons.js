/** Editorial vector miniatures. One registry, no filters, fonts, IDs or external assets. */
function characterOptionIllustrations() {
  const result = {};
  const ink = '#263442',
    skin = '#d9aa86',
    shade = '#b77d60',
    light = '#f3cfab';
  const hairInk = '#31333c',
    cloth = '#397c83',
    gold = '#d9b57b';
  const path = (d, fill, extra = '') => `<path d="${d}" fill="${fill}" ${extra}/>`;
  const line = (d, color = ink, width = 1, extra = '') =>
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" ${extra}/>`;
  const oval = (x, y, rx, ry, fill, extra = '') =>
    `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" ${extra}/>`;
  const dot = (x, y, r, fill) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
  const rect = (x, y, w, h, r, fill, extra = '') =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" ${extra}/>`;
  const ground = () => oval(50, 91, 31, 3, '#101b2c', 'opacity=".12"');
  const stage = () =>
    oval(50, 46, 37, 38, 'currentColor', 'opacity=".035"') +
    line('M12 78h7m62 0h7M18 25v-6h6m52 0h6v6', 'currentColor', 0.65, 'opacity=".14"');
  const register = (family, labels, draw) =>
    labels.forEach((label, i) => {
      result[`option-${family}-${i}`] = [
        `${label} · ${family}`,
        `Personajes · ${label} · miniatura editorial SVG original; capas de volumen, luz y detalle; selección accesible por texto, sin inferir identidad`,
        `<g transform="scale(.24)" stroke="none" stroke-width="0">${stage()}${draw(i)}</g>`,
      ];
    });

  const hairBack = (i) =>
    [
      '',
      '',
      path('M27 43Q20 14 48 10q30-1 27 36l2 34-20 1-5-28-17 28-13-4Z', hairInk),
      path('M27 25Q42 0 65 15q21 0 14 29 17 19 2 34-4 14-24 7l-20-2Q6 86 19 58 9 44 27 25Z', '#704b3d'),
      path('M26 30q-5 24 0 55l9 2 3-55m29-3q9 29 0 56l9-2q7-35-1-53', hairInk),
      path('M29 26Q1 18 12 54l10 13 8-21m39-20q30-8 19 28L78 67l-8-21', hairInk),
      path(
        'M22 56Q8 51 17 38 6 26 23 21 21 5 38 12 50 0 62 12 81 3 82 23 99 32 84 45 94 63 76 66Z',
        '#353139',
      ),
      '',
      path('M26 42Q22 9 50 9t25 33l8 46H17Z', hairInk),
      '',
    ][i];
  const hairFront = (i, color = hairInk) => {
    const shapes = [
      '',
      path('M28 41Q20 16 42 14q22-9 33 12l-1 20-7-17Q44 39 34 31Z', color) +
        line('M31 27q13-12 33-3m-28 8q12-6 24-5', '#7b7b80', 0.8),
      path('M25 45Q21 11 48 10q27-2 28 29l-11-5-1-12q-13 15-34 13l1 10Z', color) +
        line('M30 25q13-15 31-8m-28 14q16-6 26-12', '#73747c', 0.8),
      path(
        'M25 42Q17 28 29 19q-4-13 15-11 15-11 24 4 19-1 13 18l-10 15-3-17q-11 8-20-6-1 16-18 14Z',
        '#704b3d',
      ) + line('M28 30q14 1 11-14m7-2q13-9 19 9m6-6q10 6 3 17', '#ae7854', 1.1),
      path('M26 42Q21 15 49 12q29 0 28 30l-10-6-8-17-10 10-12-2-4 16Z', color) +
        line('M28 29q9-11 18-11m-14 17q13-13 21-16m5-2q15 8 15 18', '#74747d', 1) +
        [0, 1, 2, 3, 4, 5]
          .map((j) => line(`M26 ${46 + j * 7}l8 5-7 3m42-8 8 5-8 3`, '#676973', 1.3))
          .join(''),
      path('M27 40q-2-29 23-28 27-1 25 28l-9-8-1-12q-13 16-30 10l-1 10Z', color) +
        line('M32 23q15-10 30-5', '#7d7d84', 1),
      path(
        'M24 42Q8 37 22 25 15 11 32 13 33 0 47 10 58 0 67 12 84 7 80 24 96 31 79 43l-11-5-2-13-7 6-9-8-8 8-9-4-1 13Z',
        color,
      ) + line('M24 24q4-8 12-6m10-3q8-5 14 1m10 3q9 0 9 8', '#68616b', 1.2),
      path('M38 31 34 22l9-8-4-10 11 5 9-7 3 12 9 4-8 13Z', '#44576b') +
        line('M44 25 47 13m7 10 1-12', '#98b1c7', 1.3),
      path('M25 45q-3-36 25-36 29 0 26 36l-8-4-4-24q-8 10-14 12-15 6-17 14Z', color) +
        line('M29 53 25 79m45-33 5 33M32 29q6-11 14-14m7-1q16-1 18 20', '#70717a', 0.9),
      path('M28 37q-2-25 22-25t23 25l-8-9-15-3-14 4Z', '#555159') +
        line('M34 24l1-3m5 0 1-3m6 2v-3m7 3v-3m6 6 1-3m5 6 1-3', '#969095', 1),
    ];
    return shapes[i];
  };

  function portrait({
    hair = 1,
    shape = 0,
    expression = 0,
    age = 1,
    feature = -1,
    detail = -1,
    beard = 0,
    neck = 1,
  } = {}) {
    const faces = [
      'M29 34q1-20 21-20t21 20l-3 24q-4 17-18 20-14-3-18-20Z',
      'M25 36q0-22 25-22t25 22l-1 20q-2 20-24 23-22-3-24-23Z',
      'M28 34q0-20 22-20t22 20l-1 29-10 14H39L29 63Z',
      'M32 31q0-20 18-20t18 20l-1 34q-5 15-17 17-12-2-17-17Z',
      'M26 34q1-21 24-20 24-1 24 20l-7 26-17 18-17-18Z',
    ];
    const face = faces[shape];
    const neckOffset = [4, 0, -8][neck];
    const shoulders =
      path(`M38 ${66 + neckOffset}V84l-10 4q22 17 44 0l-10-8V${66 + neckOffset}Z`, skin) +
      path(`M39 ${68 + neckOffset}q13 14 23 1V83q-14 6-23-3Z`, shade) +
      path(`M10 100q0-16 23-20l7-4q10 15 21 0l7 4q23 4 23 20Z`, cloth) +
      path('M12 100q0-13 19-18l14 18Zm43 0 13-18q19 4 22 18Z', '#2a5967') +
      line('M33 81 43 94l7-7 7 7 10-13M50 89v11', '#b7dad6', 1.1);
    const head =
      hairBack(hair) +
      oval(28, 45, 4, 8, shade) +
      oval(72, 45, 4, 8, shade) +
      line('M27 42q5-3 4 7m42-7q-5-3-4 7', '#9d6956', 0.8) +
      path(face, skin) +
      path('M34 30q0-9 14-11-8 16-8 36 0 13 9 19-14-4-17-20Z', light, 'opacity=".48"') +
      path('M65 29q4 17 0 30-6 15-17 18 17 2 23-19l1-22Z', shade, 'opacity=".65"') +
      path('M33 54q9-4 13 2l-7 6Z', '#c88975', 'opacity=".4"') +
      path('M55 56q8-6 13-3l-7 9Z', '#a66f5b', 'opacity=".26"');
    let eyes =
      expression === 2
        ? oval(39, 43, 7, 8, '#f8ede1') + oval(61, 43, 7, 8, '#f8ede1')
        : path(
            `M32 43q7-${expression ? 7 : 4} 14 0-7 5-14 0m22 0q7-${expression ? 5 : 4} 14 0-7 5-14 0`,
            '#f5eadc',
          );
    eyes +=
      dot(39, 43, 2.8, '#6a8377') +
      dot(61, 43, 2.8, '#6a8377') +
      dot(39, 43, 1.5, ink) +
      dot(61, 43, 1.5, ink) +
      dot(38, 42, 0.75, '#fff6e5') +
      dot(60, 42, 0.75, '#fff6e5') +
      line(
        expression === 1
          ? 'M32 35q7-6 14-1m8 1q8-1 13 2'
          : expression === 2
            ? 'M31 31q8-7 16 1m6 0q8-8 16-1'
            : 'M32 37q6-3 13-1m10 0q7-2 13 1',
        hairInk,
        2.3,
      ) +
      line('M32 43q7-4 14 0m8 0q7-4 14 0', '#775348', 0.85) +
      path('M49 43 45 55q4 3 9 0l-3-1Z', shade) +
      line('M48 47 46 54m0 3q4 2 8 0', '#a87359', 0.65) +
      path(
        expression === 2
          ? 'M38 61q12-6 24 0-1 13-12 13T38 61Z'
          : expression === 1
            ? 'M39 62q11 1 23-4-4 12-15 10Z'
            : 'M41 63q9-3 18 0-9 6-18 0Z',
        '#965e57',
      ) +
      (expression
        ? path(expression === 2 ? 'M40 62q10-3 20 0l-2 4H42Z' : 'M41 63q10 0 18-3l-2 4-14 2Z', '#f9edda')
        : line('M43 63h14', '#744844', 0.75)) +
      line('M46 70q4 1 8 0', light, 0.8);
    if (age > 1)
      eyes += line('M35 29q15-4 30 0m-27 4q12-3 23 0M31 49l6 1m26 0 6-1m-27 8-3 7m19-7 3 7', '#9e715d', 0.85);
    if (age === 3) eyes += line('M34 53l5 1m22 0 6-1M40 66l2 4m17-5-1 6M37 39l6-1m14 0 6 1', '#946956', 0.8);
    const beards = [
      '',
      path('M32 53q6 3 9 7l9 3 10-3 8-7-2 15-16 12-15-12Z', hairInk, 'opacity=".8"') +
        line('M38 62l4 9m4-5 1 8m8-8-1 8m8-12-4 9', '#8b7872', 0.7),
      path('M31 51q8 6 9 9l10 2 10-3 9-8-2 25-17 18-17-18Z', hairInk) +
        line('M36 64l4 13m5-9 2 16m8-16-2 18m10-23-4 14', '#8b7872', 0.9),
      path('M44 65q6 3 12 0v12l-6 5-6-5Z', hairInk),
      path('M50 58q-5-6-11 3-6 1-7-2 0 8 10 6l8-3 8 3q10 2 10-6-1 3-7 2-6-9-11-3Z', hairInk),
      path('M30 39 35 42v17l-5-3Zm35 3 5-3v17l-5 3Z', hairInk),
    ];
    const features = [
      [35, 40, 59, 65, 37, 62].map((x, j) => dot(x, 52 + (j % 3) * 2, 0.9, '#996747')).join(''),
      line('M35 60q-3 2 0 4m30-4q3 2 0 4', '#a66c56', 1),
      path('M32 48q8 4 14 0l-3 5-9-1Zm22 0q8 4 14 0l-3 5-9-1Z', '#857477', 'opacity=".6"'),
      path('M32 53 45 50 38 61Zm23-3 13 3-6 8Z', '#986b57', 'opacity=".55"'),
      path('M39 62q6-6 11-2 7-4 13 2-12 13-24 0Z', '#ac6966') + line('M42 63h18', '#794843', 0.8),
      line('M31 36q8-4 16 0m6 0q8-4 17 0', hairInk, 4),
      path('M49 42 46 57h8l-3-15Z', '#c38c69') + line('M48 44v10', light, 1),
      path('M48 46q-2 8-7 9-2 6 9 6t9-6q-5-1-7-9Z', '#c38c69') + line('M43 57h2m10 0h2', '#845c4d', 1.3),
      line('M33 59q3 13 17 16 14-3 17-16', light, 2),
      line('M31 55 35 70 46 77h8l11-7 4-15', '#9e6d56', 2),
    ];
    const details = [
      line('M61 30 57 49m0-11 7 2m-8 5 6 2', '#955a55', 1.6) + line('M60 31 56 47', light, 0.7),
      line('M32 56q8-6 9 1t-7 6q-2-8 5-7m-8 11 7 2', '#366f79', 1.6),
      oval(73, 49, 4, 6, 'none', 'stroke="#e2c98c" stroke-width="1.7"') + dot(56, 59, 1.1, gold),
      path('M29 39q7-4 9 5l-4 10 7 5-7 11-5-15Zm26 23q8-6 11 2l-7 7Z', '#f1d3b9'),
      dot(61, 43, 2.8, '#c79b4b') + dot(61, 43, 1.4, ink) + dot(60, 42, 0.7, 'white'),
      dot(59, 59, 1.4, '#5e453c'),
      path('M40 62h20v5H40Z', '#fcf4e5') + line('M50 62v5', ink, 1.8),
      path('M40 62h20v5H40Z', '#fcf4e5') +
        line('M41 64h18', '#a5a9b8', 1) +
        [43, 47, 51, 55].map((x) => rect(x, 62, 2, 4, 0.5, '#8b8fa5')).join(''),
      line('M31 43q8-6 15 0m8 0q7-6 15 0', '#414e75', 2) + path('M41 63q9-4 18 0-9 7-18 0Z', '#9d3f60'),
      path('M29 42 17 29l7 25 8 4m36-16 15-13-7 25-8 4', skin) + line('M24 39l4 12m47-12-4 12', shade, 1),
    ];
    return (
      shoulders +
      `<g transform="translate(0 ${neckOffset})">` +
      head +
      eyes +
      beards[beard] +
      (feature < 0 ? '' : features[feature]) +
      hairFront(hair, age === 3 ? '#9da3aa' : hairInk) +
      (detail < 0 ? '' : details[detail]) +
      '</g>'
    );
  }

  function figure({ build = 2, outfit = -1, proportions = 0, height = 1 } = {}) {
    const shoulder = [10, 10, 13, 13, 18, 20][build];
    const waist = [7, 6, 10, 8, 16, 12][build];
    const hip = [9, 8, 11, 16, 18, 13][build];
    const y = [22, 12, 4][height],
      head = proportions === 3 ? 9 : 6;
    const top = 30 + y / 3,
      foot = 88;
    let body =
      ground() +
      path(`M${50 - hip} 57h${hip * 2}l-3 29h-9l-1-23-2 23h-9Z`, '#3c4a61') +
      path(`M${50 - hip} 58h${hip}l-3 27h-5Z`, '#53667e') +
      path(
        `M${50 - shoulder} ${top}q-6 6-9 24l-3 11 4 2 5-10 7-18m${shoulder * 2} -9q6 6 9 24l3 11-4 2-5-10-7-18`,
        skin,
      ) +
      path(
        `M${50 - shoulder} ${top}Q50 ${top - 8} ${50 + shoulder} ${top}l${waist - shoulder} 17 3 13H${47 - waist}l3-13Z`,
        cloth,
      ) +
      path(`M${50 - shoulder} ${top} 48 ${top + 10} 46 60H${47 - waist}l3-13Z`, '#65a0a0') +
      line(`M${50 + shoulder - 3} ${top + 4} 52 48l${waist} 11`, '#215c69', 1.1) +
      path(`M46 ${y + 15}v${top - y - 13}q4 4 8 0V${y + 15}Z`, skin) +
      oval(50, y + 9, head, head * 1.35, skin) +
      path(`M${50 - head} ${y + 10}q-3-13 ${head}-13t${head} 13l-3-7-7 1Z`, hairInk) +
      line(`M47 ${y + 10}h.5m5 0h.5m-5 4q2 1 4 0`, '#675045', 0.6) +
      path(`M36 ${foot - 3}h9v5H32q-1-3 4-5m18 0h9q5 2 4 5H54Z`, ink) +
      line('M35 88h9m12 0h9', '#7f929e', 0.7);
    const clothes = [
      path('M36 32 49 38 62 32l2 27H36Z', '#b88b4d') +
        path('M39 58h23l5 28H54L50 64 47 86H34Z', '#a37841') +
        line('M39 32 46 48l4-10 5 10 6-16M50 40v18', gold, 1),
      path('M36 32q14-8 28 0l-3 26H39Z', '#6758a0') +
        line('M38 36h24M50 32v25m-8 2-4 26m20-26 4 26', '#beb4dd', 1.2) +
        path('M35 84h10v5H31Zm20 0h10l5 5H55Z', '#d7dfe5'),
      path('M40 32q10 8 20 0l-3 17 18 36H25l18-36Z', '#bb7188') +
        path('M44 51 35 82h12l3-29Z', '#e8adc0') +
        line('M40 34q10 11 20 0M39 60h22M31 80h38', '#f0c5ce', 1),
      path('M35 29 50 33 65 29l13 59H22Z', '#456a79') +
        path('M40 35h20l-2 23H42Z', '#b5bdad') +
        path('M30 33 38 30l3 57H25Zm32-3 9 4 6 53H59Z', '#284b5f') +
        line('M50 37v17m-8-10h16M34 65h33', gold, 1.5) +
        dot(50, 64, 2, gold),
      path('M36 31q14 6 28 0l-4 24 13 32H27l14-32Z', '#2d303e') +
        path('M43 55h14l8 31H34Z', '#454252') +
        line('M40 34 50 45 60 34M50 45v39m-9-24h18', '#a496b0', 0.8) +
        oval(50, 38, 2, 3, '#b994be'),
      path('M35 31 47 29h6l12 2-3 32H37Z', '#354253') +
        path('M44 30 50 46 56 30Z', '#ede0cc') +
        path('M49 34h2l2 15-3 4-3-4Z', '#ad6e66') +
        line('M39 33 44 47l6-4m11-10-5 14-6-4M50 53v8', '#8192a3', 1),
      path('M36 32q14-8 28 0l3 29H34Z', '#c08350') +
        path('M38 34q12-4 24 0l-4 9H42Z', '#e5ad6b') +
        line('M50 44v16m-10-7h7m7 0h7', '#754d3f', 1) +
        path('M38 61h24l3 24H54l-4-19-3 19H36Z', '#42617c'),
      path('M36 31 46 29q4 4 8 0l10 2 5 12-9 3-2 14H42l-2-14-9-3Z', '#e5dbc9') +
        line('M46 31q4 6 8 0m-13 13 2 13m16-13-2 13', '#b6a795', 1),
    ];
    if (outfit >= 0) body += clothes[outfit];
    if (proportions === 1) return `<g transform="translate(0 16) scale(1 .82)">${body}</g>`;
    if (proportions === 2) return `<g transform="translate(8 -4) scale(.84 1.04)">${body}</g>`;
    return body;
  }

  function eye(i) {
    const shapes = [
      'M16 49q31-28 68 0-34 28-68 0Z',
      'M17 48q33-40 66 0-32 40-66 0Z',
      'M16 49q32-12 68 0-35 20-68 0Z',
      'M16 54Q48 22 84 40q-22 33-68 14Z',
      'M16 40q35-13 68 14-42 19-68-14Z',
      'M16 51q34-23 68 0-34 25-68 0Z',
      'M19 50q30-24 62 0-31 25-62 0Z',
    ];
    const irisHeight = [12, 15, 6, 10, 10, 10, 10][i];
    const center = [49, 48, 50, 47, 47, 51, 50][i];
    return (
      path('M8 39q42-32 84 0v29q-41 23-84 0Z', '#d7ae91') +
      path('M12 44q40-25 76 0v18q-38 24-76 0Z', '#ebc5a8') +
      path(shapes[i], '#f4ecdf') +
      oval(50, center, 12, irisHeight, '#79958e') +
      oval(50, center, 8, irisHeight - 1, '#526f6d') +
      oval(50, center, 5, Math.min(5, irisHeight - 2), ink) +
      dot(46, center - Math.min(5, irisHeight / 2), 2, '#faf3df') +
      dot(54, center + 3, 1, '#e0ded0') +
      line(shapes[i], '#7d5546', 1.1) +
      line('M18 29q31-15 65 0', hairInk, 3.5) +
      line(
        i === 5 ? 'M19 40q30-18 63 0' : i === 6 ? 'M18 34q33-15 64 1' : 'M19 39q30-22 62 0',
        '#b2866b',
        1.2,
      ) +
      line('M23 67q26 11 52 0', '#b78f75', 0.9)
    );
  }

  function accessory(i) {
    const silver = '#a9bfcc';
    return (
      ground() +
      [
        portrait({ hair: 1 }),
        path('M11 42 21 36h58l10 6-4 4-8-4H23l-8 4Z', ink) +
          rect(13, 39, 32, 26, 10, '#6ca0a5', 'fill-opacity=".3" stroke="#c4a576" stroke-width="2.4"') +
          rect(55, 39, 32, 26, 10, '#6ca0a5', 'fill-opacity=".3" stroke="#c4a576" stroke-width="2.4"') +
          line('M45 47q5-5 10 0M20 45l8-2m34 2 8-2', silver, 2),
        oval(50, 67, 40, 10, '#303d50') +
          path('M25 64 30 31q20-15 40 0l5 33q-25 12-50 0Z', '#47556b') +
          path('M31 32q17-10 31-3l6 30-37 4Z', '#64758a') +
          path('M27 54q23 8 46 0l2 10q-25 12-50 0Z', '#aa7c5b') +
          line('M33 32q14-7 26-3', silver, 1),
        line('M17 22q0 39 33 58 33-19 33-58', '#8e6942', 4) +
          line('M18 22q0 39 32 57 32-18 32-57', gold, 2) +
          path('M50 66 61 78 50 91 39 78Z', '#bda477') +
          path('M50 70 57 78 50 86 43 78Z', '#77a7a4') +
          line('M50 72v12', '#d9eeea', 1),
        path('M31 31q-4-23 19-23t19 23', 'none', 'stroke="#b58c64" stroke-width="5"') +
          rect(20, 28, 60, 60, 13, '#a47d58') +
          path('M26 34q24-8 48 0v43q-25 8-48 0Z', '#c59d6b') +
          rect(28, 59, 44, 24, 6, '#8a6b50') +
          line('M30 65h40M40 35v15m20-15v15', '#e1c29a', 1.2) +
          rect(45, 58, 10, 12, 2, '#d3b981') +
          line('M50 61v5', '#785a41', 1),
        path('M17 58V45q0-36 33-36t33 36v13', 'none', 'stroke="#374459" stroke-width="11"') +
          line('M18 42q1-29 32-29t32 29', '#819aab', 2) +
          rect(12, 47, 17, 34, 7, '#253144') +
          rect(71, 47, 17, 34, 7, '#253144') +
          rect(15, 50, 10, 27, 4, '#667f90') +
          rect(75, 50, 10, 27, 4, '#667f90') +
          line('M20 54v18m60-18v18', silver, 1.3),
      ][i]
    );
  }

  function texture(i, mode = 'pattern') {
    let art = rect(17, 17, 66, 66, 18, '#74999a') + path('M21 64q30 12 58-6v19q-29 12-58 0Z', '#50777f');
    if (mode === 'pattern') {
      const patterns = [
        path('M24 23q22-9 49 0v7q-25-8-49 0Z', '#a4c3bc'),
        [
          [31, 36, 9, 6],
          [61, 30, 8, 7],
          [56, 61, 12, 9],
          [28, 69, 5, 7],
        ]
          .map((a) => oval(...a, '#345567'))
          .join(''),
        [0, 1, 2, 3].map((j) => path(`M20 ${25 + j * 16}q24 14 60 0v6q-30 17-60 0Z`, '#355c6d')).join(''),
        Array.from({ length: 30 }, (_, j) =>
          dot(24 + ((j * 17) % 53), 25 + Math.floor(j / 6) * 11, 1.5 + (j % 3), '#35596a'),
        ).join(''),
        path('M50 17h15q18 0 18 18v30q0 18-18 18H50Z', '#e0cbaa'),
        [0, 1, 2, 3, 4]
          .map((j) =>
            rect(19, 20 + j * 12, 62, 12, 0, ['#a8c7bc', '#92b7ae', '#74999a', '#5c828c', '#426677'][j]),
          )
          .join(''),
      ];
      art += patterns[i];
    } else if (mode === 'finish') {
      art += [
        line('M28 31h43M28 35h43M28 39h43', '#9bb9b5', 0.8),
        path('M26 25q18-10 34-4L24 65Z', '#c7e0d6') + line('M71 33v27', '#b8d4cb', 2),
        line('M23 32l11-7m-8 36 13-7m26-24 11 7M54 70l13-7', '#c5d0b8', 3),
        path('M20 48 34 37l11 9 18-21 18 11v41L55 82 38 68 20 75Z', '#ad7450') +
          dot(37, 54, 7, '#c59260') +
          dot(69, 63, 9, '#754f43'),
        path('M17 34 64 17h10L17 75Zm16 49L83 33v10L43 83Z', '#dae7de', 'opacity=".6"') +
          line('M24 26v36m5-39v15', '#e7f4e9', 1.5),
      ][i];
    } else {
      const samples = [
        line('M23 27q22 8 52-1M24 39q23-7 50 4m-49 9q25 9 48-2m-45 16q18-6 42 3', '#4e7377', 1.2),
        Array.from({ length: 12 }, (_, j) => line(`M${24 + j * 4} 26l-3 48`, '#b7c7b0', 0.8)).join(''),
        Array.from({ length: 20 }, (_, j) =>
          path(
            `M${21 + (j % 4) * 15} ${24 + Math.floor(j / 4) * 11}q7 14 14 0`,
            'none',
            'stroke="#b7c7b0" stroke-width="1.1"',
          ),
        ).join(''),
        Array.from({ length: 7 }, (_, j) => path(`M${24 + j * 7} 75q-6-28 0-50 7 27 0 50Z`, '#acc6b5')).join(
          '',
        ),
        path('M23 23h53v53H23Z', '#7a8d9b') +
          path('M23 23h44L23 67Z', '#b9c9cd') +
          line('M29 29h40m-40 4h25', '#e0e5dc', 1),
        line(
          'M28 23q-13 17 2 29t-1 27m15-57q-7 26 1 57m14-58q-9 13-2 25t1 31m14-53q-9 22 1 48',
          '#3e6065',
          2,
        ),
      ];
      art += samples[i];
    }
    return ground() + art + line('M25 26q19-13 44-4', '#d8e2cd', 1.3);
  }

  function creature(i, species = 'mammal', mode = 'coat') {
    let art = ground();
    if (species === 'bird') {
      art +=
        path('M32 75Q12 51 30 31q18-23 39-6 22 17 6 48L53 85Z', '#668a9b') +
        path('M30 42q-15 27 21 40L45 54Z', '#a6c4c2') +
        path('M64 40 88 48 66 55Z', '#c29b60') +
        oval(53, 40, 10, 11, '#d9dbc2') +
        dot(55, 40, 4, ink) +
        dot(54, 38, 1.5, 'white') +
        line('M43 85l-7 6m20-7 4 7M31 51q-5 18 9 22', '#36596c', 1.4);
      art += (
        mode === 'anatomy'
          ? [
              '',
              path('M66 40 97 49 66 53Z', '#c29b60') + line('M73 47h18', '#edd4a3', 0.8),
              path('M35 46Q4 52 14 84q23-4 29-20Z', '#aac6c3') +
                line('M19 77 32 55m-6 24 10-21', '#50798b', 1),
              path('M38 73 18 95l29-11 4 13 10-20Z', '#456b81'),
            ]
          : [
              '',
              path('M34 25 39 9l7 11 9-15 3 17Z', '#d7ac74'),
              path('M32 58 14 86l26-11-7 18 21-14Z', '#456b81'),
              path('M28 37q-11 0-8 8-9 5-1 12-6 10 5 11m10-47q-3-11 8-10 5-8 12-2', '#aac8c6'),
            ]
      )[i % 4];
    } else if (species === 'insect') {
      art +=
        oval(50, 60, 24, 30, '#537e7a') +
        path('M50 31q-32 1-24 39l24 18Z', '#8fac8e') +
        line(
          'M50 34v52M31 43l-15-7-7 7m20 14-17 2-7 9m26 2-13 10v10m51-47 15-7 7 7m-20 14 17 2 7 9m-26 2 13 10v10',
          ink,
          2,
        ) +
        oval(50, 29, 16, 13, '#334954') +
        dot(42, 28, 4, gold) +
        dot(58, 28, 4, gold) +
        line('M41 18 32 9m27 9 9-9', '#a9b9a3', 1.7);
      art += (
        mode === 'anatomy'
          ? [
              line('M41 18Q12-3 10 14m49 4Q88-3 90 14', '#a9b9a3', 2),
              oval(21, 49, 14, 24, '#cfe3d9', 'opacity=".75"') +
                oval(79, 49, 14, 24, '#cfe3d9', 'opacity=".75"') +
                line('M14 32 29 65m57-33L71 65', '#94b8b6', 1),
              line(
                'M29 44 17 37 8 42m20 15-16 4-7 9m25 0-12 12v9m53-47 12-7 9 5m-20 15 16 4 7 9m-25 0 12 12v9',
                gold,
                2.1,
              ),
              path('M39 36 28 29q-6 16 13 16m20-9 11-7q6 16-13 16Z', gold),
            ]
          : [
              line('M31 50q9-6 13-3', '#c6d5ab', 2),
              line('M29 53h42m-42 13h42m-38 12h34', '#263f4a', 2),
              path('M28 47q0-15 18-13L28 65Z', '#dce7bd', 'opacity=".6"'),
              line('M31 39 25 29m11 11-4-13m30 13 5-14m3 22 11-6', gold, 2),
            ]
      )[i % 4];
    } else if (species === 'fish') {
      art +=
        path('M72 45 92 26v48L72 59Q35 93 11 52q26-38 61-7Z', '#639a9c') +
        path('M17 51q23 30 54 5-24 34-54-5Z', '#c3cbb0') +
        path('M40 32 53 12 66 37M44 70l14 18 6-24Z', '#416c80') +
        dot(29, 45, 6, '#e0d8b4') +
        dot(29, 45, 3, ink) +
        line('M40 39q10 14 0 25m9-23q7 9 0 18M16 54h6', '#2e596b', 1.3);
      art += (
        mode === 'anatomy'
          ? [
              path('M51 49 72 27 67 69Z', '#a0c3b9') + line('M55 49 67 35m-10 19 8-10', '#d5dfcc', 1),
              path('M73 46 97 15q-9 36 0 65L73 59Z', '#759eaa') +
                line('M81 44 93 24m-11 25 12-7m-12 13 11 15', '#c5d9ce', 1),
              path('M13 54q30-19 62-2-32 28-62 2Z', '#bbccb1'),
              line('M39 39q8 12 0 24m5-23q8 11 0 22m5-20q7 10 0 18', '#285568', 1.8),
            ]
          : [
              path('M51 49 70 36 66 62Z', '#9abeb4'),
              line('M79 43 89 33m-10 17h11m-11 7 10 11', '#bdcbb4', 1),
              path('M37 33q14-8 29 8l-22 3Z', '#aacac1'),
              line('M40 42l6 4m-7 3 7 4m-6 3 5 3', gold, 1.7),
            ]
      )[i % 4];
    } else {
      art +=
        path(
          mode === 'anatomy' && i === 0
            ? 'M26 39Q7 19 24 14l19 15h14l19-15q17 5-2 25 16 44-24 48-41-4-24-48Z'
            : 'M27 38 20 12 41 28h18l21-16-7 26q18 45-23 49-42-4-23-49Z',
          mode === 'coat' && i === 3 ? '#c59e8f' : '#9a8267',
        ) +
        path('M32 31 25 21l4 21m39-11 7-10-4 21', '#ceaaa0') +
        path('M30 54q20-12 40 0l-7 22-13 8-13-8Z', '#ddd1b3') +
        path('M30 44q8-6 15 0m10 0q8-6 15 0', 'none', 'stroke="#4b4e46" stroke-width="2"') +
        oval(38, 47, 6, 5, '#d4ce98') +
        oval(62, 47, 6, 5, '#d4ce98') +
        oval(38, 47, 1.6, 4, ink) +
        oval(62, 47, 1.6, 4, ink) +
        path('M44 60q6-4 12 0l-6 6Z', '#725c55') +
        line('M50 66v5m-9-1q9 8 18 0M20 61l15 3m30 0 15-3', ink, 1);
      if (mode === 'anatomy')
        art += [
          oval(25, 26, 6, 8, '#c8a595') + oval(75, 26, 6, 8, '#c8a595'),
          line('M23 17 29 34m48-17-6 17', '#f2d5b6', 2),
          path('M73 80q27-2 16-21-7-9-11-2 8-1 7 7-1 7-14 9Z', '#b6a184'),
          path('M24 76h20v15H22Zm32 0h20l2 15H56Z', '#b9a58a') +
            line('M27 86v4m6-4v4m31-4v4m6-4v4', '#796954', 0.8),
        ][i];
      else if (i === 1) art += line('M26 32 22 48l5 7-4 8 8 10m44-41 3 16-5 7 4 8-8 10', '#cfbc98', 2);
      else if (i === 2)
        art += line(
          'M26 34q-7-6-8 1t7 9m50-10q7-6 8 1t-7 9M29 69q-9 5-1 12t7-6M35 29q3-7 8-1t7-1m6 0q3-7 8-1',
          '#c4af88',
          2,
        );
      else if (i === 3)
        art += line('M37 32q13-5 26 0m-23 3q10-3 20 0M33 53l7 3m20 0 7-3M44 74h12', '#9d776a', 0.9);
    }
    return art;
  }

  function object(i, mode = 'material') {
    if (mode === 'material') {
      if (i === 3)
        return (
          ground() +
          path(
            'M25 28 51 15 78 28v48L51 89 25 75Z',
            '#a4c6c4',
            'fill-opacity=".35" stroke="#a1c1c4" stroke-width="1.3"',
          ) +
          line('M25 28 51 42 78 28M51 42v47M32 30l11-6m-10 9 11-6', '#dce8dd', 1.5)
        );
      return (
        ground() +
        path(
          'M23 29 50 15 78 29 50 43Z',
          ['#d6b482', '#c9d1d3', '#b4a5cc', '#a6c8c1', '#c5bcaa', '#b5a58c'][i],
        ) +
        path(
          'M23 29 50 43v45L23 74Z',
          ['#a67d53', '#708895', '#867b9e', '#739c9c', '#999b91', '#8c7c70'][i],
        ) +
        path(
          'M50 43 78 29v45L50 88Z',
          ['#87684d', '#506979', '#645e7c', '#4c7f84', '#727b7b', '#6d6963'][i],
        ) +
        line('M29 33v36l15 8M55 46l17-9', '#f2dfba', 0.7, 'opacity=".6"') +
        (i === 0
          ? line('M27 43q8 7 17 6m-16 8q8 9 16 7m13-10q8-8 16-8m-16 21q8-8 16-8', '#7b5f48', 1)
          : i === 1
            ? line('M30 37v23m5-20v13m23-4v20', '#e5e4d2', 1.4)
            : i === 5
              ? line('M29 42l12 8m-12 0 12 8m-12 0 12 8m17-14 13-7m-13 15 13-7', '#baa68d', 1)
              : '')
      );
    }
    const base =
      rect(24, 25, 52, 52, 11, '#587c89') +
      path('M29 29h20v43H29Z', '#89adae') +
      line('M33 32h28', '#c6d8c7', 1.5);
    if (mode === 'face')
      return (
        ground() +
        base +
        [
          '',
          dot(40, 45, 4, ink) + dot(60, 45, 4, ink) + line('M39 60q11 10 22 0', ink, 2),
          oval(39, 46, 9, 11, '#dedec3') +
            oval(61, 46, 9, 11, '#dedec3') +
            dot(40, 46, 4, ink) +
            dot(60, 46, 4, ink) +
            line('M44 64h12', ink, 2),
          rect(32, 38, 36, 24, 5, '#2c485c') + line('M38 46h5m14 0h5m-21 9h18', '#bad3c6', 2),
        ][i]
      );
    return (
      ground() +
      base +
      [
        line('M29 80h42', '#a1b8b7', 1),
        line('M24 43 11 56l3 10m62-23 13 13-3 10M38 77l-4 11m28-11 4 11', gold, 4),
        dot(32, 80, 9, ink) + dot(68, 80, 9, ink) + dot(32, 80, 4, '#9cadad') + dot(68, 80, 4, '#9cadad'),
        oval(50, 88, 29, 4, '#9dbebb', 'opacity=".3"') +
          line('M18 71v-9m64 9v-9M22 84v-5m56 5v-5', gold, 1.3),
        line('M31 77q-3 17-17 10m28-10q-1 21-13 16m29-16q1 21 13 16m-2-16q3 17 17 10', '#7aa3a4', 4),
      ][i]
    );
  }

  function entity(i, mode = 'form') {
    const shapes = [
      'M39 32q-9-23 11-23t11 23l18 19-15 6 4 28-18-8-18 8 4-28-15-6Z',
      'M25 35Q19 15 40 19q13-22 28 0 22-3 19 18 20 16-3 31 1 22-24 17-20 13-31-4-25 6-23-17Q-3 43 25 35Z',
      'M50 15a35 35 0 1 1 0 70 35 35 0 1 1 0-70Z',
      'M51 9q4 29 32 17-19 18 10 34-31-8-30 31-14-30-42-11 16-25-10-40 31 3 40-31Z',
      'M23 32 16 12 39 26h20l25-14-7 20q14 42-27 53-42-11-27-53Z',
    ];
    const formIndex = mode === 'form' ? i : 0;
    let body =
      ground() +
      path(shapes[formIndex], '#81b5b8', 'opacity=".8"') +
      path(shapes[formIndex], 'none', 'stroke="#c6e4db" stroke-width="1"') +
      path('M36 33q-13 19 2 34 6 7 14 5-17-20-8-40Z', '#d0e5d4', 'opacity=".45"') +
      line('M16 73q34 20 69-7M22 79q30 13 56-1', '#a6d2c9', 1, 'opacity=".55"');
    if (mode === 'opacity')
      body =
        `<g opacity="${[1, 0.65, 0.35, 0.7][i]}">${body}</g>` +
        (i === 3 ? line('M20 30h18m24 18h20M26 67h19', '#d3e2d1', 2) : '');
    if (mode === 'drift')
      body += line(
        [
          'M14 62v-9m72 9v-9M25 83h50',
          'M15 82q17-17 40-10t30-4',
          'M35 82l-9 8m37-8 9 8',
          'M12 40h12m51 28h15M17 66h8',
        ][i],
        gold,
        1.6,
      );
    return body;
  }

  function substance(i, mode = 'mist') {
    if (mode === 'element')
      return (
        ground() +
        [
          path('M48 9q8 28 22 32 23 29-5 44-31 13-46-9-15-26 14-46-4 21 7 21 14-3 8-42Z', '#c48657') +
            path('M50 43q8 20 14 23 6 20-14 20-24-5-9-24-3 17 5 11 8-7 4-30Z', '#f0d19a'),
          path('M50 9q-9 24-28 44-21 38 28 38t28-38Q59 33 50 9Z', '#599ba9') +
            path('M35 40Q9 74 39 82q-10-22 2-40Z', '#bad8cf') +
            line('M61 73q10-2 10-12', '#d0e7df', 1.8),
          path('M16 62 35 27 57 18 83 56 76 82 37 89Z', '#9e9d7e') +
            path('M35 27 45 57 16 62 37 89l8-32 31 25 7-26-26-38-12 39Z', '#657d7b') +
            line('M36 32 43 55 23 61m25 2 24 15', '#d6caa4', 1.2),
          line('M12 39q57-30 68-9t-39 17q-36 0-22 17 17 17 63-8M25 76q40 11 48-2', '#9ac8c7', 5) +
            line('M14 39q57-27 65-9M24 65q18 9 47-1', '#d9e7d8', 1.2),
          path('M50 9 79 29 87 63 65 88 29 83 13 53 28 21Z', '#8cb5c0') +
            path('M50 9 43 46 13 53 47 61 65 88 62 48 79 29 50 38Z', '#c6dcda') +
            line('M28 23 43 46 30 79m19-64 1 24 25-9M48 62l15 22', '#e3ede2', 1),
        ][i]
      );
    const art = entity(i % 3, 'form');
    if (mode === 'shadow')
      return `<g opacity=".65">${art}</g>` + path('M29 43q20-27 44 1l-5 27-18 13-22-17Z', '#26394e');
    return (
      art +
      [
        line('M13 48q22-15 42 0t34-2M10 58q24-15 45 0t35-2', '#c5ddd3', 3, 'opacity=".6"'),
        line('M50 2v10m0 76v10M3 50h10m74 0h10M16 16l7 7m54 54 7 7m0-68-7 7M23 77l-7 7', gold, 1.3),
        path('M53 8 29 55h17l-2 37 28-50H54l8-34Z', '#d4c69b') + line('M53 24 38 51h15l-3 22', '#f1e5bf', 1),
        Array.from({ length: 16 }, (_, j) =>
          dot(12 + ((j * 23) % 78), 13 + ((j * 17) % 74), 1.3 + (j % 3), j % 2 ? gold : '#a6d3cb'),
        ).join(''),
      ][i]
    );
  }

  register('person', ['Común (Average)', 'Expresivo', 'Exagerado'], (i) => {
    if (i === 0) return ground() + portrait({ hair: 1 });
    if (i === 1) return ground() + portrait({ hair: 3, expression: 1, shape: 4 });
    return (
      ground() +
      portrait({ hair: 7, expression: 2, shape: 1 }) +
      oval(38, 43, 12, 12, 'none', 'stroke="#d5b87b" stroke-width="1.8"') +
      oval(62, 43, 12, 12, 'none', 'stroke="#d5b87b" stroke-width="1.8"') +
      line('M49 42h2', gold, 2)
    );
  });
  register(
    'hair',
    [
      'Sin cabello',
      'Corto',
      'Bob',
      'Ondulado',
      'Trenzas',
      'Coletas',
      'Afro',
      'Cresta',
      'Largo y liso',
      'Rapado',
    ],
    (i) => portrait({ hair: i }),
  );
  register('face', ['Ovalado', 'Redondo', 'Cuadrado', 'Alargado', 'Corazón'], (i) =>
    portrait({ shape: i, hair: 0 }),
  );
  register(
    'features',
    [
      'Pecas',
      'Hoyuelos',
      'Ojeras',
      'Pómulos marcados',
      'Labios carnosos',
      'Cejas pobladas',
      'Nariz recta',
      'Nariz ancha',
      'Mandíbula suave',
      'Mandíbula marcada',
    ],
    (i) => portrait({ feature: i, hair: 1 }),
  );
  register(
    'detail',
    [
      'Cicatriz',
      'Tatuaje',
      'Piercing',
      'Vitíligo',
      'Heterocromía',
      'Lunar',
      'Diente separado',
      'Brackets',
      'Maquillaje',
      'Orejas puntiagudas',
    ],
    (i) => portrait({ detail: i, expression: [6, 7].includes(i) ? 2 : 0 }),
  );
  register('beard', ['Sin barba', 'Barba corta', 'Barba larga', 'Perilla', 'Bigote', 'Patillas'], (i) =>
    portrait({ beard: i }),
  );
  register('neck', ['Corto', 'Medio', 'Largo'], (i) => portrait({ neck: i, hair: 0 }));
  register('age', ['Joven', 'Adulto', 'Maduro', 'Anciano'], (i) =>
    portrait({ age: i, hair: i === 3 ? 9 : 1, shape: i === 0 ? 1 : 0 }),
  );
  register(
    'eye',
    ['Almendrados', 'Redondos', 'Monólidos', 'Ascendentes', 'Descendentes', 'Encapotados', 'Profundos'],
    eye,
  );
  register('build', ['Delgada', 'Esbelta', 'Media', 'Curvilínea', 'Corpulenta', 'Musculosa'], (i) =>
    figure({ build: i }),
  );
  register('proportions', ['Equilibradas', 'Compactas', 'Alargadas', 'Caricaturescas'], (i) =>
    figure({ proportions: i }),
  );
  register(
    'height',
    ['Baja', 'Media', 'Alta'],
    (i) =>
      figure({ height: i }) +
      line('M18 11v77m-3-76h6m-6 76h6M16 26h4m-4 15h4m-4 15h4m-4 15h4', 'currentColor', 0.8, 'opacity=".35"'),
  );
  register(
    'wardrobe',
    ['Retro', 'Deportiva', 'Romántica', 'Fantasía medieval', 'Gótica', 'Formal', 'Urbana', 'Casual'],
    (i) => figure({ outfit: i }),
  );
  register(
    'accessory',
    ['Sin accesorios', 'Gafas', 'Sombrero', 'Collar', 'Mochila', 'Auriculares'],
    accessory,
  );
  register('style', ['Natural', 'Estilizado', 'Fantástico', 'Animación 3D', 'Ilustrado'], (i) => {
    let art = portrait({
      hair: [1, 2, 8, 3, 1][i],
      expression: i === 3 ? 2 : 0,
      shape: i === 1 ? 3 : 0,
      detail: i === 2 ? 9 : -1,
    });
    if (i === 3)
      art += oval(34, 54, 6, 3, '#d28c7e', 'opacity=".45"') + oval(65, 54, 6, 3, '#d28c7e', 'opacity=".45"');
    if (i === 4)
      art += line('M24 44 33 35m-7 18 8-8m-8 16 9-8m-1 14 6-8M64 77l7-8m-9 11 6-5', '#775d54', 0.65);
    return art;
  });
  // Identity/ancestry are declared data, never an anatomical prediction.
  register(
    'gender',
    ['Mujer', 'Hombre', 'Hombre trans', 'Mujer trans', 'No binario'],
    (i) =>
      oval(50, 49, 27, 33, 'none', 'stroke="#89b3b3" stroke-width="1.5"') +
      oval(50, 49, 19, 25, 'none', 'stroke="#cbb98e" stroke-width="1"') +
      path('M35 61q1-12 15-12t15 12l-4 7H39Z', cloth) +
      oval(50, 38, 8, 10, skin) +
      line(
        [
          'M50 77v15m-7-7h14',
          'M68 26 82 12m-11 0h11v11',
          'M67 27 82 12m-10 0h10v10M50 77v15m-7-7h14',
          'M50 77v15m-7-7h14M68 26l14-14m-11 0h11v11',
          'M50 8V2M24 20l-6-6m58 6 6-6M18 50h-8m72 0h8',
        ][i],
        gold,
        2,
      ),
  );
  register(
    'ancestry',
    ['Africana', 'Asiática oriental', 'Europea', 'Sudasiática', 'Medio oriental', 'Latinoamericana', 'Mixta'],
    (i) => {
      const maps = [
        'M37 31 60 29 70 43 59 53 55 75 44 80 38 59 28 47Z',
        'M33 29 57 23 75 34 73 48 62 54 67 67 57 72 46 56 31 53Z',
        'M37 31 49 24 56 34 69 31 72 43 60 49 61 64 50 59 39 46 30 45Z',
        'M38 27 67 34 60 49 53 73 46 69 40 49 30 41Z',
        'M32 35 53 29 68 39 77 56 61 64 48 52 37 57 25 43Z',
        'M28 24 44 31 43 43 56 49 63 62 50 82 44 77 41 58 30 49Z',
        'M25 29 42 23 49 39 38 50 27 45Zm34-3 17 9-7 15-16-4ZM44 58l18-5 8 16-20 12-14-11Z',
      ];
      return (
        oval(50, 50, 36, 36, '#354d62') +
        oval(50, 50, 35, 35, 'none', 'stroke="#8eaaa9" stroke-width="1"') +
        oval(50, 50, 16, 35, 'none', 'stroke="#789397" stroke-width=".6"') +
        line('M15 50h70M22 31q28 10 56 0M22 69q28-10 56 0', '#789397', 0.6) +
        path(maps[i], gold) +
        path(maps[i], 'none', 'stroke="#e7d4ac" stroke-width=".6"')
      );
    },
  );
  register('pattern', ['Sólido', 'Manchas', 'Rayas', 'Moteado', 'Bicolor', 'Degradado'], (i) => texture(i));
  register('finish', ['Mate', 'Brillante', 'Desgastado', 'Oxidado', 'Transparente'], (i) =>
    texture(i, 'finish'),
  );
  register('covering', ['Piel', 'Pelaje', 'Escamas', 'Plumas', 'Metal', 'Corteza'], (i) =>
    texture(i, 'covering'),
  );
  register('scale', ['Pequeño', 'Mediano', 'Grande', 'Gigante'], (i) => {
    const size = [0.46, 0.62, 0.79, 1][i];
    return (
      ground() +
      line('M14 85h73M17 17v68m-3-68h6m-6 23h6m-6 23h6', 'currentColor', 0.8, 'opacity=".3"') +
      `<g transform="translate(${50 - 50 * size} ${86 - 86 * size}) scale(${size})">${figure({})}</g>`
    );
  });
  for (const species of ['mammal', 'bird', 'insect', 'fish']) {
    register(
      `coat-${species}`,
      species === 'bird'
        ? ['Liso', 'Cresta', 'Plumas largas', 'Plumón']
        : species === 'insect'
          ? ['Liso', 'Segmentado', 'Brillante', 'Espinoso']
          : species === 'fish'
            ? ['Escamas lisas', 'Escamas rugosas', 'Piel húmeda', 'Traslúcida']
            : ['Corto', 'Largo', 'Rizado', 'Sin pelo'],
      (i) => creature(i, species),
    );
    register(
      `anatomy-${species}`,
      species === 'bird'
        ? ['Pico corto', 'Pico largo', 'Alas amplias', 'Cola larga']
        : species === 'insect'
          ? ['Antenas largas', 'Alas transparentes', 'Seis patas', 'Mandíbulas grandes']
          : species === 'fish'
            ? ['Aletas amplias', 'Cola de abanico', 'Cuerpo alargado', 'Branquias visibles']
            : ['Orejas redondas', 'Orejas puntiagudas', 'Cola larga', 'Patas cortas'],
      (i) => creature(i, species, 'anatomy'),
    );
  }
  register(
    'temperament',
    ['Tranquilo', 'Curioso', 'Juguetón', 'Reservado', 'Enérgico', 'Protector'],
    (i) =>
      creature(i % 4) +
      [
        line('M33 45q5 4 10 0m14 0q5 4 10 0', ink, 2),
        line('M16 19q-4-10 4-12t8 6q-1 4-6 5v4', gold, 2) + dot(22, 28, 1.4, gold),
        dot(80, 76, 8, gold) + line('M75 73l10 6m-6-11 1 15', ink, 1),
        path('M30 62q20 12 40 0v16L50 89 30 78Z', '#537b83'),
        line('M14 19l-5 12m73-12 6 12M8 50h8m68 0h8', gold, 2),
        path('M50 62 67 68v13L50 94 33 81V68Z', '#b9a274') + line('M40 76 47 83 60 71', '#f4e4bd', 2),
      ][i],
  );
  register('object', ['Madera', 'Metal', 'Plástico', 'Vidrio', 'Cerámica', 'Tela'], (i) => object(i));
  register('plant-material', ['Hojas', 'Corteza', 'Flores', 'Musgo'], (i) =>
    i === 1
      ? texture(5, 'covering')
      : ground() +
        line('M50 87V38m0 20L30 38m20 30 22-23', '#658f84', 2) +
        [
          path('M50 50Q18 48 19 19q32-1 31 31m0 17q29 0 31-30-30 0-31 30Z', '#7fae94') +
            line('M24 25 47 48m8 14 20-18', '#c8d5a8', 1),
          '',
          [0, 1, 2, 3, 4]
            .map((j) => `<g transform="rotate(${j * 72} 50 36)">${oval(50, 23, 10, 16, '#c28a9c')}</g>`)
            .join('') +
            dot(50, 36, 10, gold) +
            dot(47, 33, 3, '#f1d7a6'),
          Array.from({ length: 20 }, (_, j) =>
            oval(23 + ((j * 17) % 54), 48 + ((j * 11) % 32), 8, 9, ['#638d76', '#89aa82', '#acbc8a'][j % 3]),
          ).join(''),
        ][i],
  );
  register('robot-material', ['Metal', 'Cerámica', 'Plástico', 'Fibra de carbono'], (i) =>
    i === 3 ? texture(1, 'covering') : object([1, 4, 2][i]),
  );
  register('object-face', ['Sin rostro', 'Ojos y boca', 'Ojos grandes', 'Rostro integrado'], (i) =>
    object(i, 'face'),
  );
  register('motion', ['Sin extremidades', 'Brazos y piernas', 'Ruedas', 'Flotación', 'Tentáculos'], (i) =>
    object(i, 'motion'),
  );
  register('entity', ['Silueta humanoide', 'Nube', 'Esfera', 'Forma abstracta', 'Silueta animal'], (i) =>
    entity(i),
  );
  register('mist', ['Niebla', 'Luz', 'Energía', 'Partículas'], (i) => substance(i));
  register('element', ['Fuego', 'Agua', 'Tierra', 'Aire', 'Hielo'], (i) => substance(i, 'element'));
  register('shadow', ['Oscuridad', 'Humo', 'Vacío'], (i) => substance(i, 'shadow'));
  register('opacity', ['Sólida', 'Translúcida', 'Etérea', 'Intermitente'], (i) => entity(i, 'opacity'));
  register('drift', ['Flota', 'Se desliza', 'Camina', 'Se dispersa'], (i) => entity(i, 'drift'));
  register('hybrid', ['Rasgos felinos', 'Rasgos de ave', 'Rasgos reptilianos', 'Rasgos humanos'], (i) =>
    i === 3 ? portrait({ hair: 1 }) : creature(i, i === 1 ? 'bird' : i === 2 ? 'fish' : 'mammal'),
  );
  register(
    'cyborg',
    ['Orgánico y metal', 'Prótesis visibles', 'Implantes discretos'],
    (i) =>
      portrait({ hair: 0 }) +
      [
        path('M50 15q20 0 21 20l-4 27-17 16Z', '#7b969d') +
          line('M51 19 63 29v13l-6 7v19', '#c6d8d0', 1.2) +
          dot(60, 43, 3, gold),
        path('M57 60 75 73 82 98H61Z', '#748e9b') + line('M66 74 71 90m-9-12 10 1', '#d4ddd1', 1.3),
        line('M62 31v7l-5 5m7-1v14l-7 5', gold, 1.5) + dot(63, 32, 2, '#c8d9d1'),
      ][i],
  );
  register('vegetal', ['Hojas', 'Raíces', 'Flores', 'Corteza'], (i) =>
    i === 1
      ? ground() +
        line('M50 16v38m0-6-18 10-8 25m26-26 16 8 12 20M50 57l-7 20-9 12m16-27 10 22', '#8c9c77', 5) +
        line('M49 25v27m-1 7-7 17', gold, 1)
      : i === 3
        ? texture(5, 'covering')
        : portrait({ hair: 0 }) +
          path(
            i === 0
              ? 'M28 39Q6 10 33 11l17 18Q52 0 76 9L63 32q30-11 28 14L69 57Z'
              : 'M27 29q-17-14-6-21 10-4 19 10Q39 0 51 4q11 1 8 15 10-16 21-5 6 8-8 17l-22 4Z',
            i === 0 ? '#719881' : '#c48a9e',
          ) +
          dot(50, 25, 6, gold),
  );
  register(
    'anatomy-fae',
    ['Orejas puntiagudas', 'Rasgos etéreos', 'Alas translúcidas'],
    (i) =>
      portrait({ hair: 8, detail: 9 }) +
      (i === 2
        ? path('M26 57Q0 16 6 63q-3 24 20 20m48-26q26-41 20 6 3 24-20 20', '#a0ccc5', 'opacity=".65"')
        : i === 1
          ? line('M14 24h9m-5-4v8m60-9v9m-4-4h8', gold, 1.2)
          : ''),
  );
  register(
    'anatomy-orc',
    ['Colmillos', 'Piel rugosa', 'Mandíbula prominente'],
    (i) =>
      portrait({ shape: 2, hair: 0, feature: i === 2 ? 9 : -1 }) +
      (i === 0
        ? path('M38 66 39 54 46 65m8 0 7-11 1 12', '#f3dfb9')
        : i === 1
          ? line('M32 51l7-2m-7 7 6-2m24-3 7-2m-7 7 6-2', '#94745e', 1.5)
          : ''),
  );
  register(
    'anatomy-android',
    ['Carcasa lisa', 'Juntas mecánicas', 'Circuitos visibles'],
    (i) =>
      object(1, 'face') +
      (i === 0
        ? line('M30 32 38 30m-8 7 8-2', '#e0e4d7', 2)
        : i === 1
          ? dot(24, 52, 5, gold) + dot(76, 52, 5, gold)
          : line('M31 33h12v10m26 25H57V58M35 69v-8h8', gold, 1.6)),
  );
  register(
    'anatomy-alien',
    ['Antenas', 'Ojos múltiples', 'Piel luminosa'],
    (i) =>
      portrait({ hair: 0, shape: 3 }) +
      [
        line('M37 20 27 5m35 15L73 5', '#799e9c', 3) + dot(27, 5, 3, gold) + dot(73, 5, 3, gold),
        oval(50, 30, 6, 4, '#f1e2c4') + dot(50, 30, 2, ink),
        line('M32 31v8m35-8v8M33 54l7 4m20 0 7-4', '#d8d9b2', 2),
      ][i],
  );
  register('hybrid-detail', ['Alas', 'Cuernos', 'Cola', 'Brazos adicionales', 'Ojos múltiples'], (i) => {
    if (i === 0)
      return (
        ground() +
        path('M46 77Q7 67 8 20q20 0 34 22L50 57l8-15Q72 20 92 20 93 67 54 77Z', '#87a9b1') +
        line('M13 26 44 67m-26-25 22 24m46-40L56 67m26-25-22 24', '#d0ddd3', 1.3)
      );
    if (i === 2)
      return (
        ground() +
        path('M25 78q60 2 45-51-6-12-16-2 7-3 8 7 4 28-28 32Z', '#a7aa87') +
        line('M32 74q44-2 35-42', gold, 1.1)
      );
    if (i === 3)
      return (
        figure({}) +
        line('M37 42 19 52 12 70m51-28 18 10 7 18', skin, 6) +
        line('M36 53 24 64l-3 14m43-25 12 11 3 14', skin, 5)
      );
    return (
      portrait({ hair: 0 }) +
      (i === 1
        ? path('M30 31Q3 16 24 3q-8 19 12 21m34 7Q97 16 76 3q8 19-12 21', gold)
        : oval(50, 30, 6, 4, '#f1e2c4') + dot(50, 30, 2, ink))
    );
  });
  return result;
}

/** Kubrick Space icon family. Original vector drawings; edit this registry and rebuild assets. */
/** Approved isotype geometry in the shared 24px grid. No filters or external references. */
function kubrickIsotype(ink = 'var(--kubrick-ink, #fff)') {
  return `<g stroke="none"><path d="M12 0 22.45 18.05H1.55Z" fill="#7819ff"/><circle cx="12" cy="12" r="8.4375" fill="${ink}"/><circle cx="12" cy="12" r="4.21875" fill="#7819ff"/></g>`;
}

export const ICONS = Object.freeze({
  ...characterOptionIllustrations(),
  grid: [
    'Proyectos',
    'Inicio · categorías',
    '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  ],
  book: [
    'Libro',
    'Biblioteca · creación · tarjetas verticales de ingredientes por clic o arrastre',
    '<path d="M12 6v15M12 6C9 3 6 3 3 4v15c3-1 6-1 9 2 3-3 6-3 9-2V4c-3-1-6-1-9 2Z"/>',
  ],
  character: [
    'Personaje',
    'Biblioteca · creación · tarjetas verticales de ingredientes por clic o arrastre',
    '<circle cx="12" cy="7" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  ],
  stage: [
    'Escenario',
    'Biblioteca · creación · navigator',
    '<path d="m3 20 6-12 4 7 3-5 5 10H3ZM9 8l2 4H7"/><circle cx="17" cy="5" r="1"/>',
  ],
  video: [
    'Cine y video',
    'Creación · biblioteca · timeline audiovisual',
    '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 10h18M7 5l3 5M14 5l3 5m-6 3 4 2-4 2Z"/>',
  ],
  music: [
    'Música',
    'Biblioteca · creación · referencias musicales',
    '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2.5"/><ellipse cx="17" cy="16" rx="3" ry="2.5"/>',
  ],
  settings: [
    'Configuración',
    'Inicio · configuración independiente',
    '<path d="M10.4 4.47 10.51 2.62h2.98l.11 1.85 2.59 1.07 1.39-1.23 2.11 2.11-1.23 1.39 1.07 2.59 1.85.11v2.98l-1.85.11-1.07 2.59 1.23 1.39-2.11 2.11-1.39-1.23-2.59 1.07-.11 1.85h-2.98l-.11-1.85-2.59-1.07-1.39 1.23-2.11-2.11 1.23-1.39-1.07-2.59-1.85-.11v-2.98l1.85-.11 1.07-2.59-1.23-1.39 2.11-2.11 1.39 1.23 2.59-1.07Z"/><circle cx="12" cy="12" r="3.25"/>',
  ],
  trash: [
    'Eliminar',
    'Papelera · ingredientes · medios · imágenes reemplazadas del personaje · eliminar párrafo de Story Book',
    '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
  ],
  save: [
    'Guardar',
    'Toolbar · conversaciones',
    '<path d="M4 3h13l4 4v14H3V4a1 1 0 0 1 1-1ZM7 3v6h9V3M7 21v-7h10v7"/>',
  ],
  download: ['Exportar', 'Toolbar · configuración', '<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>'],
  upload: ['Subir', 'Portadas · retratos · archivos', '<path d="M12 16V4m-5 5 5-5 5 5M4 15v5h16v-5"/>'],
  'chevron-left': ['Anterior', 'Volver · calendario · historial', '<path d="m15 5-7 7 7 7"/>'],
  'chevron-right': ['Siguiente', 'Calendario · historial · agente · submenús', '<path d="m9 5 7 7-7 7"/>'],
  'chevron-down': ['Desplegar', 'Listas · árbol del libro', '<path d="m5 9 7 7 7-7"/>'],
  'chevron-up': ['Contraer', 'Listas · árbol del libro', '<path d="m5 15 7-7 7 7"/>'],
  close: ['Cerrar', 'Modales · paneles · eliminación de vínculo', '<path d="m6 6 12 12M18 6 6 18"/>'],
  plus: [
    'Añadir',
    'Nuevo proyecto · ingredientes · escenas · biblioteca universal de rasgos, ropa y props',
    '<path d="M12 5v14M5 12h14"/>',
  ],
  'insert-paragraph': [
    'Insertar párrafo',
    'Story Book · centro sólido fundido con la línea mediante cuatro arcos circulares iguales · cruz transparente',
    '<g transform="translate(0 6) scale(0.375)"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M0 14.75H11.9891A12 12 0 0 0 21.99455 9.375A12 12 0 0 1 42.00545 9.375A12 12 0 0 0 52.0109 14.75H64V17.25H52.0109A12 12 0 0 0 42.00545 22.625A12 12 0 0 1 21.99455 22.625A12 12 0 0 0 11.9891 17.25H0ZM31 10H33V15H38V17H33V22H31V17H26V15H31Z"/></g>',
  ],
  'timeline-port': [
    'Puerto temporal',
    'Story Book · puertos de elementos, fechas, rangos y puntos disponibles · círculo sólido con uniones tangenciales calculadas para la línea y los cables',
    '<circle cx="12" cy="12" r="12" fill="currentColor" stroke="none"/>',
  ],
  minus: ['Reducir', 'Controles de escala', '<path d="M5 12h14"/>'],
  search: [
    'Buscar',
    'Biblioteca · listas · expandir selección',
    '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  ],
  sun: [
    'Tema claro',
    'Toolbar · documentación',
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
  ],
  moon: ['Tema oscuro', 'Toolbar · documentación', '<path d="M20 15A9 9 0 0 1 9 4a8 8 0 1 0 11 11Z"/>'],
  fx: [
    'FX · Colores del fondo',
    'Toolbar de todos los workspaces · activar retícula aurora · violeta, amarillo y rojo intencionales',
    '<path color="#a78bfa" d="M4 19V5h7M4 12h6"/><path color="#f7e355" d="m14 5 8 14"/><path color="#f87171" d="m22 5-8 14"/>',
  ],
  eye: [
    'Ver',
    'Vista previa · mostrar clave',
    '<path d="M2 12c5-9 15-9 20 0-5 9-15 9-20 0Z"/><circle cx="12" cy="12" r="3"/>',
  ],
  'eye-off': [
    'Ocultar',
    'Configuración independiente · ocultar clave',
    '<path d="m3 3 18 18M7 5.5c5-2.5 11 0 15 6.5l-3 4M3 8l-1 4c4 7 10 9 16 6M10 10a3 3 0 0 0 4 4"/>',
  ],
  folder: ['Recursos', 'Navigator · proyectos genéricos', '<path d="M3 5h7l2 3h9v12H3V5Z"/>'],
  layers: ['Capas', 'Estructura · categorías', '<path d="m3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4"/>'],
  tag: [
    'Definición',
    'Tarjetas arrastrables de definición · etiquetas del editor',
    '<path d="M3 4h9l9 9-8 8-10-9V4Z"/><circle cx="7.5" cy="8" r="1"/>',
  ],
  ingredients: [
    'Ingredientes',
    'Menú lateral izquierdo · panel de Ingredientes · encabezados del editor',
    '<path d="M8 3h8M10 3v6l-6 10a1.4 1.4 0 0 0 1 2h14a1.4 1.4 0 0 0 1-2L14 9V3M7 15h10"/><path d="M10 17h.01M14 19h.01"/>',
  ],
  traits: [
    'Rasgos',
    'Navigator · personaje',
    '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
  ],
  'prop-library': [
    'Biblioteca universal',
    'Barra izquierda de Personajes, debajo de Ingredientes · explorar rasgos, ropa, props y papelera independiente',
    '<rect x="3" y="3" width="7" height="7" rx="2"/><path d="M14 3h7v7h-7zM3 14h7v7H3z"/><circle cx="17.5" cy="17.5" r="3.5"/><path d="M6.5 5v3M5 6.5h3M15.5 17.5h4M17.5 15.5v4"/>',
  ],
  props: [
    'Props y accesorios',
    'Biblioteca universal · pestaña Props; reloj original, distinto de la retícula de Todo y del acceso lateral',
    '<path d="m8 6 1-4h6l1 4m-8 12 1 4h6l1-4"/><rect x="5" y="6" width="14" height="12" rx="4"/><path d="M12 8.5V12l2.5 1.5M19 10h2v4h-2"/>',
  ],
  agent: [
    'Kubrick Space',
    'Acciones contextuales de IA · generación asistida. Estrella sólida de cuatro puntas con lados curvos; el asistente general usa kubrick.',
    '<path d="M12 2C13.4 7.6 16.4 10.6 22 12C16.4 13.4 13.4 16.4 12 22C10.6 16.4 7.6 13.4 2 12C7.6 10.6 10.6 7.6 12 2Z" fill="currentColor" stroke="none"/>',
  ],
  kubrick: [
    'Isotipo Kubrick Space',
    'Asistente general · identidad de marca entregada por el usuario, reproducida en SVG: triángulo y centro violeta #7819ff, anillo negro en claro y blanco en oscuro. Sin filtros.',
    kubrickIsotype(),
  ],
  'kubrick-light': [
    'Isotipo para fondo claro',
    'Favicon claro · anillo negro y violeta de marca; geometría compartida con el isotipo del asistente.',
    kubrickIsotype('#000'),
  ],
  'kubrick-dark': [
    'Isotipo para fondo oscuro',
    'Favicon oscuro · anillo blanco y violeta de marca; geometría compartida con el isotipo del asistente.',
    kubrickIsotype('#fff'),
  ],
  interpreting: [
    'Interpretando',
    'Carga · ayudante de personajes y overlays de nodos. Isotipo Kubrick Space giratorio; movimiento reducido conserva el símbolo estático.',
    kubrickIsotype(),
  ],
  tasks: [
    'Tareas activas',
    'Barra izquierda de todos los workspaces · cola del servidor, progreso y cancelación de trabajos de personaje',
    '<path d="M9 5h12M9 12h6M9 19h4"/><circle cx="4" cy="5" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="19" r="1"/><path d="M18 11a5 5 0 1 1-3.5 8.5M18 14v3l2 1"/>',
  ],
  stop: [
    'Cancelar tarea',
    'Panel Tareas activas · detener un trabajo del servidor; toolbar · descargar modelo local de VRAM',
    '<rect x="5" y="5" width="14" height="14" rx="3"/><rect x="9" y="9" width="6" height="6" rx=".8" fill="currentColor" stroke="none"/>',
  ],
  code: ['Código', 'Navigator · editor HTML', '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>'],
  focus: ['Enfoque', 'Navigator', '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/>'],
  edit: ['Editar', 'Navigator · formato · calendario', '<path d="m4 16 12-12 4 4L8 20l-5 1 1-5Zm9-9 4 4"/>'],
  grip: [
    'Arrastrar',
    'Estructura e ingredientes',
    '<circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/>',
  ],
  check: ['Confirmar', 'Checkbox · estado correcto', '<path d="m4 12 5 5L20 6"/>'],
  refresh: [
    'Actualizar',
    'Reescribir · sincronizar ingrediente · Generar Otra propuesta del personaje y compararla con la principal · regenerar una pieza Outfit · restaurar foto de personaje · reintentar solicitud fallida del ayudante de personajes',
    '<path d="M20 4v6h-6M4 20v-6h6M20 10a8 8 0 0 0-14-5M4 14a8 8 0 0 0 14 5"/>',
  ],
  'arrow-right': ['Avanzar', 'Wizard · acciones', '<path d="M3 12h18m-7-7 7 7-7 7"/>'],
  'arrow-up-right': ['Abrir', 'Inicio · documentación', '<path d="M5 19 19 5M6 5h13v13"/>'],
  'arrow-down': ['Ir abajo', 'Documentación', '<path d="M12 3v18m-7-7 7 7 7-7"/>'],
  sort: ['Ordenar', 'Listas · documentación', '<path d="M8 3v18m-4-4 4 4 4-4M16 21V3m-4 4 4-4 4 4"/>'],
  volume: [
    'Audio',
    'Vista audiovisual',
    '<path d="M3 9h4l5-4v14l-5-4H3V9Zm13-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  ],
  play: [
    'Reproducir',
    'Previsualización audiovisual; toolbar · cargar modelo local en VRAM',
    '<path d="m7 4 13 8-13 8V4Z"/>',
  ],
  pause: ['Pausar', 'Previsualización audiovisual', '<path d="M7 4v16M17 4v16"/>'],
  disc: [
    'Álbum',
    'Creación · vista musical',
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M6 12a6 6 0 0 1 6-6m0 12a6 6 0 0 0 6-6"/>',
  ],
  home: ['Interior', 'Creación de escenario', '<path d="m3 10 9-7 9 7M5 9v12h14V9M10 21v-7h4v7"/>'],
  tree: ['Exterior', 'Creación de escenario', '<path d="m12 3-6 7h3l-5 7h6v4h4v-4h6l-5-7h3l-6-7Z"/>'],
  shield: [
    'Protagonista',
    'Creación de personaje',
    '<path d="M12 3 4 6v7c0 4 4 7 8 9 4-2 8-5 8-9V6l-8-3Z"/><path d="m8 12 3 3 5-6"/>',
  ],
  mask: [
    'Antagonista',
    'Creación de personaje · atmósfera',
    '<path d="M4 4c5 3 11 3 16 0v9c0 5-5 8-8 9-3-1-8-4-8-9V4Z"/><path d="m7 10 3 1m4 0 3-1M9 17c2-2 4-2 6 0"/>',
  ],
  brush: [
    'Arte',
    'Storyboard · animación · color · generar foto desde el ayudante de personaje',
    '<path d="m10 14 9-11 2 2-9 11M10 14c-4-2-6 1-5 4l-2 3c5 1 10-2 9-5l-2-2Z"/>',
  ],
  image: [
    'Imagen',
    'Portada · medios · fotografía adjunta al cambio del ayudante de personajes y del chat principal de Kubrick Space',
    '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="2"/><path d="m3 18 5-5 4 3 4-5 5 7"/>',
  ],
  camera: [
    'Retrato',
    'Generación de personaje · documental',
    '<path d="M3 7h5l2-3h4l2 3h5v13H3V7Z"/><circle cx="12" cy="13" r="4"/>',
  ],
  headphones: [
    'Referencia de audio',
    'Ingredientes musicales',
    '<path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/>',
  ],
  score: [
    'Arreglo',
    'Panel musical',
    '<path d="M3 5h18M3 9h18M3 13h18M3 17h18M14 17V6l4 1"/><ellipse cx="11" cy="17" rx="3" ry="2"/>',
  ],
  document: ['Documento', 'Letra · guion · guía', '<path d="M5 3h10l4 4v14H5V3Zm10 0v5h4M8 12h8M8 16h6"/>'],
  crop: ['Recortar', 'Recorte de rostro', '<path d="M7 2v15h15M2 7h15v15M11 7h6v6"/>'],
  highlighter: ['Resaltar', 'Formato de texto', '<path d="m5 14 9-11 7 6-9 11-7-6Zm0 0-2 6 6-1M3 23h10"/>'],
  eraser: ['Limpiar formato', 'Editor', '<path d="m3 15 10-12 8 7-10 11H8l-5-6Zm5-6 8 7M11 21h10"/>'],
  wand: [
    'Corregir',
    'Acciones de IA',
    '<path d="m4 18 11-11 3 3L7 21 4 18Zm8-8 3 3M5 3v4M3 5h4M19 3v3M17.5 4.5h3M20 16v4M18 18h4"/>',
  ],
  dice: [
    'Aleatorio',
    'Generación de personaje',
    '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="8" cy="8" r=".6"/><circle cx="16" cy="8" r=".6"/><circle cx="12" cy="12" r=".6"/><circle cx="8" cy="16" r=".6"/><circle cx="16" cy="16" r=".6"/>',
  ],
  bolt: ['Continuar', 'Acciones de IA', '<path d="M13 2 4 14h7l-1 8 10-12h-7V2Z"/>'],
  lock: [
    'Proteger',
    'Fragmentos protegidos',
    '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  ],
  expand: ['Expandir', 'Acciones de texto', '<path d="M14 3h7v7M10 21H3v-7m18-11-7 7M3 21l7-7"/>'],
  bold: ['Negrita', 'Formato de texto', '<path d="M7 4h6a4 4 0 0 1 0 8H7V4Zm0 8h7a4 4 0 0 1 0 8H7v-8Z"/>'],
  italic: ['Cursiva', 'Formato de texto', '<path d="M10 4h10M4 20h10M15 4 9 20"/>'],
  underline: ['Subrayado', 'Formato de texto', '<path d="M6 3v9a6 6 0 0 0 12 0V3M4 21h16"/>'],
  heading2: [
    'Título 2',
    'Formato de texto',
    '<path d="M3 5v14M11 5v14M3 12h8m4 0c0-4 6-4 6 0 0 3-6 4-6 7h6"/>',
  ],
  heading3: [
    'Título 3',
    'Formato de texto',
    '<path d="M3 5v14M11 5v14M3 12h8m4-2c2-3 6-1 6 1 0 1-1 2-3 2 4 0 4 6-2 6"/>',
  ],
  more: [
    'Más opciones',
    'Menú del chat',
    '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  ],
  chat: ['Conversación', 'Chat · biblioteca', '<path d="M3 4h18v13H9l-6 4V4Z"/><path d="M7 8h10M7 12h7"/>'],
  spinner: [
    'Procesando',
    'Sincronización · cargas · isotipo de Kubrick Space con giro CSS.',
    kubrickIsotype(),
  ],
  timeline: [
    'Línea de tiempo',
    'Cronología · roadmap',
    '<path d="M4 12h16M7 6v12M17 6v12"/><circle cx="7" cy="12" r="2"/><circle cx="17" cy="12" r="2"/>',
  ],
  link: [
    'Vincular',
    'Relaciones e ingredientes',
    '<path d="m10 7 3-3a5 5 0 0 1 7 7l-3 3M14 17l-3 3a5 5 0 0 1-7-7l3-3m1 6 8-8"/>',
  ],
  warning: ['Advertencia', 'Avisos de la aplicación', '<path d="m12 3 10 18H2L12 3ZM12 9v5m0 3v.1"/>'],
  info: ['Información', 'Ayuda y estados', '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>'],
  clock: ['Tiempo', 'Metadatos y fechas', '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3"/>'],
});

const aliases = Object.freeze({
  all: 'grid',
  song: 'music',
  book: 'book',
  stage: 'stage',
  character: 'character',
  video: 'video',
  '📖': 'book',
  '👤': 'character',
  '🏔️': 'stage',
  '🎬': 'video',
  '🎵': 'music',
  '📦': 'folder',
  '📂': 'folder',
  '🏷️': 'tag',
  '🧪': 'ingredients',
  '✏️': 'edit',
  '✨': 'agent',
  '🦸': 'shield',
  '🦹': 'mask',
  '🧬': 'traits',
  '💿': 'disc',
  '📝': 'document',
  '🎭': 'mask',
  '🎧': 'headphones',
  '🎼': 'score',
  '🏠': 'home',
  '🌲': 'tree',
  '🎞️': 'video',
  '📹': 'camera',
  '🖌️': 'brush',
  '📄': 'document',
  '🎨': 'brush',
  '🖼️': 'image',
  '🛠️': 'traits',
  '🗑️': 'trash',
  '📥': 'download',
  '📤': 'upload',
  '📷': 'camera',
  '✂️': 'crop',
  '🖊️': 'highlighter',
  '🧹': 'eraser',
  '❌': 'close',
  '🎲': 'dice',
  '🪄': 'wand',
  '🔍': 'search',
  '🔄': 'refresh',
  '⚡': 'bolt',
  '🔒': 'lock',
  '🔊': 'volume',
  '▶️': 'play',
  '⏸️': 'pause',
  '➕': 'plus',
  '🌙': 'moon',
  '☀️': 'sun',
  '✦': 'agent',
  '×': 'close',
  '✕': 'close',
  '❮': 'chevron-left',
  '❯': 'chevron-right',
  '▸': 'chevron-right',
  '▾': 'chevron-down',
  '⌄': 'chevron-down',
  '↗': 'arrow-up-right',
  '←': 'chevron-left',
  '↻': 'refresh',
  '▤': 'document',
  '⌁': 'timeline',
  '☼': 'sun',
  '☾': 'moon',
  '＋': 'plus',
  '+': 'plus',
  '⌕': 'search',
  '↓': 'arrow-down',
  '↕': 'sort',
});

/** Only registered IDs are rendered; stored legacy emoji remain data, never injected markup. */
export function renderIcon(value, size = 20) {
  const name = Object.hasOwn(ICONS, value)
    ? value
    : Object.hasOwn(aliases, value)
      ? aliases[value]
      : 'folder';
  const dimension = Number.isFinite(size) ? Math.min(96, Math.max(12, size)) : 20;
  return `<svg class="kai-icon" data-icon="${name}" width="${dimension}" height="${dimension}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name][2]}</svg>`;
}
