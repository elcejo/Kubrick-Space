const { CHARACTER_REVIEW_PROMPT } = require('../../../public/js/contracts/character-instructions.js');
const { createHash } = require('node:crypto');
const {
  planCharacterComposition,
  characterLocalCompositionPrompt,
} = require('../../../public/js/contracts/character-composition.js');
const {
  characterAssetImage,
  characterAssetKind,
  characterAssetSlot,
  characterAppearanceKey,
} = require('../../../public/js/contracts/character-visual-library.js');

/** Same validator for tool arguments and a complete JSON-only completion. */
function reviewPayload(choice, tool) {
  if (!choice?.message || choice.message.refusal) throw Error('missing_completion');
  if (choice.finish_reason === 'length') throw Error('truncated');
  if (choice.finish_reason && !['stop', 'tool_calls'].includes(choice.finish_reason))
    throw Error('incomplete_completion');
  const calls = choice.message.tool_calls;
  let raw;
  if (calls !== undefined && calls !== null && (!Array.isArray(calls) || calls.length)) {
    if (!Array.isArray(calls) || calls.length !== 1 || calls[0]?.function?.name !== tool)
      throw Error('invalid_tool');
    raw = calls[0].function.arguments;
  } else {
    raw = choice.message.content;
    if (typeof raw === 'string') {
      raw = raw.trim();
      const fence = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(raw);
      if (fence) raw = fence[1];
    }
  }
  if (typeof raw !== 'string' || raw.length > 24000) throw Error('invalid_json');
  try {
    return JSON.parse(raw);
  } catch {
    throw Error('invalid_json');
  }
}

/** Cosmetic text and transport aliases must not invalidate a complete visual verdict. */
function normalizeReview(value, items) {
  const fail = (reason) => {
    throw Error(reason);
  };
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !['preserved', 'checks', 'message'].includes(key)) ||
    typeof value.preserved !== 'boolean'
  )
    fail('invalid_verdict');
  if (value.message !== undefined && typeof value.message !== 'string') fail('invalid_message');
  if (!Array.isArray(value.checks) || value.checks.length !== items.length) fail('invalid_check_count');
  const used = new Set();
  const checks = value.checks.map((check) => {
    if (
      !check ||
      typeof check !== 'object' ||
      Array.isArray(check) ||
      Object.keys(check).some((key) => !['id', 'status', 'message'].includes(key))
    )
      fail('invalid_check');
    const matches = items.filter(
      (item, index) =>
        check.id === item.id ||
        check.id === `part_${index + 1}` ||
        (typeof check.id === 'string' &&
          /^asset_[a-f0-9]{8}$/i.test(check.id) &&
          item.id.startsWith(check.id + '-')),
    );
    if (matches.length !== 1 || used.has(matches[0].id)) fail('invalid_check_id');
    const item = matches[0];
    used.add(item.id);
    if (!['match', 'missing', 'mismatch', 'occluded', 'uncertain'].includes(check.status))
      fail('invalid_check_status');
    if (check.message !== undefined && typeof check.message !== 'string') fail('invalid_message');
    const message = (check.message || '').trim().slice(0, 240);
    const status =
      check.status === 'occluded' && (item.category === 'traits' || !message) ? 'uncertain' : check.status;
    return { id: item.id, status, message };
  });
  return { preserved: value.preserved, checks, message: (value.message || '').trim().slice(0, 300) };
}

/** Bind cached images/reviews to the precise input, never to just a step number. */
function characterCompositionSignature(
  {
    project,
    document,
    baseImage,
    referenceImage,
    compositionRequest = '',
    changedKeys = [],
    visualScopes = [],
    forceIds = [],
  },
  plan,
) {
  plan ||= planCharacterComposition(project.characterVisualLibrary, project.id, {
    document,
    changedKeys,
    visualScopes,
    forceIds,
  });
  return createHash('sha256')
    .update(
      JSON.stringify({
        projectId: project.id,
        original: referenceImage || project.covers?.[project.currentCoverIndex] || project.covers?.[0],
        baseImage: baseImage || '',
        identity: document.identity,
        appearance: characterAppearanceKey(document),
        compositionRequest,
        changedKeys,
        visualScopes,
        forceIds,
        selected: plan.selected,
        removed: plan.removed,
        steps: plan.steps,
      }),
    )
    .digest('hex');
}

function createCharacterCompositionReviewer({
  security,
  assertProject,
  readCharacterImage,
  getApiKeys,
  getLLMConfig,
  llmConfig,
  openrouterModels,
  proxyRequest,
}) {
  return async ({ body }) => {
    if (!body || typeof body !== 'object') throw security.fail('Revisión de composición inválida.');
    assertProject(body.projectId);
    const config = getLLMConfig();
    const limits = llmConfig.functionConfig(config, 'character_composition');
    const info = openrouterModels.findModel(limits.model);
    if (info?.inputModalities?.length && !info.inputModalities.includes('image'))
      throw security.fail('El modelo de texto debe admitir visión para comprobar Outfit.', 428);
    const key = getApiKeys().openrouter || '';
    if (!key && !llmConfig.isLocalModel(limits.model))
      throw security.fail('Configura OpenRouter para comprobar la composición.', 428);
    if (body.preflight === true) return { status: 200, body: { ready: true } };
    if (
      !Array.isArray(body.items) ||
      (!body.items.length && !body.removedItems?.length) ||
      body.items.length > 24 ||
      body.items.some(
        (item) =>
          !item ||
          typeof item.id !== 'string' ||
          !['traits', 'clothing', 'props'].includes(item.category) ||
          (item.role !== undefined && !['preserve', 'replace', 'reapply', 'edit'].includes(item.role)),
      )
    )
      throw security.fail('Piezas de revisión inválidas.');
    if (
      body.removedItems !== undefined &&
      (!Array.isArray(body.removedItems) ||
        body.removedItems.length > 48 ||
        body.removedItems.some(
          (item) =>
            !item ||
            typeof item.id !== 'string' ||
            typeof item.kind !== 'string' ||
            typeof item.description !== 'string' ||
            item.description.length > 4000 ||
            typeof item.label !== 'string' ||
            item.label.length > 200,
        ))
    )
      throw security.fail('Piezas retiradas inválidas.');
    const donors = body.items.filter((item) => item.role !== 'preserve');
    const images = [body.referenceImage, body.candidateImage, ...donors.map((item) => item.image)];
    if (
      images.length > 8 ||
      images.some((image) => !characterAssetImage(image, body.projectId)) ||
      body.items.some((item) => !characterAssetImage(item.image, body.projectId)) ||
      new Set(body.items.map((item) => item.id)).size !== body.items.length
    )
      throw security.fail('Referencias de revisión inválidas.');
    const tool = 'review_character_composition';
    // A small local model often writes a summary a little over the limit. The local node rejects the whole
    // call for that, discarding a correct review, so local runs keep the limit out of the schema and
    // normalizeReview truncates the text instead.
    const textLimit = (max) => (llmConfig.isLocalModel(limits.model) ? {} : { maxLength: max });
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await proxyRequest(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}` },
          body: JSON.stringify({
            model: limits.model,
            max_tokens: Math.min(limits.maxCompletionTokens, 8192),
            ...(limits.model === 'xiaomi/mimo-v2.6-pro'
              ? {
                  provider: { allow_fallbacks: true, require_parameters: true },
                  reasoning: { effort: 'low' },
                }
              : {}),
            tool_choice: 'required',
            tools: [
              {
                type: 'function',
                function: {
                  name: tool,
                  description:
                    'Comprueba por píxeles cada pieza solicitada y las zonas que deben conservarse.',
                  parameters: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['preserved', 'checks', 'message'],
                    properties: {
                      preserved: { type: 'boolean' },
                      message: { type: 'string', ...textLimit(300) },
                      checks: {
                        type: 'array',
                        minItems: body.items.length,
                        maxItems: body.items.length,
                        items: {
                          type: 'object',
                          additionalProperties: false,
                          required: ['id', 'status', 'message'],
                          properties: {
                            id: { type: 'string', enum: body.items.map((_, index) => `part_${index + 1}`) },
                            status: {
                              type: 'string',
                              enum: ['match', 'missing', 'mismatch', 'occluded', 'uncertain'],
                            },
                            message: { type: 'string', ...textLimit(240) },
                          },
                        },
                      },
                    },
                  },
                },
              },
            ],
            messages: [
              {
                role: 'system',
                content:
                  llmConfig.characterPrompt(config, 'character_composition', CHARACTER_REVIEW_PROMPT) +
                  '\nReturn exactly one check for each item ID supplied in this request (part_1, part_2, etc.). Copy those IDs exactly. Never invent, omit or duplicate a check. preserved is a JSON boolean; status must use the tool enum. Do not include checks for components outside this batch. authorizedComposition, when supplied, explicitly permits that camera/framing/pose normalization. Do not mark preserved=false for those authorized composition changes; all selected components, identity and style still require verification.' +
                  (attempt
                    ? '\nThe preceding response failed the output contract. Inspect the same images again and return a complete tool call using precisely the supplied IDs and statuses.'
                    : ''),
              },
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      subject: body.subject,
                      authorizedKinds: body.authorizedKinds,
                      visualScopes: body.visualScopes,
                      expectedFields: body.expectedFields,
                      compositionRequest: body.compositionRequest,
                      ...(body.canonicalReferencePose === true
                        ? {
                            authorizedComposition:
                              'Canonical studio reference: straight-on level camera at vertical midpoint, full natural silhouette, white background and relaxed A-pose for the actual humanoid anatomy. This normalization of camera, framing and pose is authorized; preserve identity, style and all selected features.',
                          }
                        : {}),
                      removedItems: body.removedItems || [],
                      items: body.items.map((item, index) => ({
                        id: `part_${index + 1}`,
                        kind: characterAssetKind(item),
                        label: item.label,
                        role: item.role || 'replace',
                        ...(item.role === 'preserve'
                          ? { image: 1 }
                          : { description: item.description, image: donors.indexOf(item) + 3 }),
                      })),
                    }),
                  },
                  ...images.map((image) => ({
                    type: 'image_url',
                    image_url: {
                      url: readCharacterImage(body.projectId, image.split('/').pop()),
                      detail: 'high',
                    },
                  })),
                ],
              },
            ],
          }),
        },
        Math.min(limits.timeoutMs, 180000),
        { omitBody: true, completionStream: true },
      );
      if (result.error)
        return {
          status: result.status || 502,
          body: {
            code:
              result.status === 504
                ? 'CHARACTER_COMPOSITION_REVIEW_TIMEOUT'
                : 'CHARACTER_COMPOSITION_REVIEW_PROVIDER',
            error:
              result.status === 504
                ? 'El modelo agotó el tiempo de revisión. La imagen generada se conserva; puedes reintentar solo la comprobación sin volver a generar.'
                : 'No se pudo comprobar la propuesta. La imagen generada y la foto principal se conservan.',
          },
        };
      try {
        const value = normalizeReview(reviewPayload(result.data?.choices?.[0], tool), body.items);
        return { status: 200, body: value };
      } catch (error) {
        const choice = result.data?.choices?.[0];
        // Metadata only: never record arguments, prompts, images, keys or reasoning.
        console.warn('[Character composition review]', {
          reason: [
            'missing_completion',
            'truncated',
            'incomplete_completion',
            'invalid_tool',
            'invalid_json',
            'invalid_verdict',
            'invalid_message',
            'invalid_check_count',
            'invalid_check',
            'invalid_check_id',
            'invalid_check_status',
          ].includes(error.message)
            ? error.message
            : 'invalid_schema',
          finishReason: choice?.finish_reason || 'missing',
          tools: Array.isArray(choice?.message?.tool_calls) ? choice.message.tool_calls.length : 0,
          attempt: attempt + 1,
          generationId:
            typeof result.data?.id === 'string' && /^gen-[A-Za-z0-9-]{1,120}$/.test(result.data.id)
              ? result.data.id
              : undefined,
        });
        if (
          attempt === 0 &&
          !['truncated', 'missing_completion', 'incomplete_completion', 'invalid_tool'].includes(
            error.message,
          )
        )
          continue;
        return {
          status: 502,
          body: {
            code: 'CHARACTER_COMPOSITION_REVIEW_FORMAT',
            error:
              'La respuesta de revisión no tiene un formato válido. La imagen generada está guardada; reintenta la comprobación sin volver a generar.',
          },
        };
      }
    }
  };
}

/** Used by the workspace, its assistant and Kubrick Space; one reviewed transaction across bounded stages. */
async function runCharacterComposition({
  project,
  document,
  ctx,
  prefix = 'outfit',
  helpers,
  picture,
  reject,
  retain,
  baseImage,
  referenceImage,
  compositionRequest = '',
  changedKeys = [],
  visualScopes = [],
  forceIds = [],
  canonicalReferencePose = false,
}) {
  const plan = planCharacterComposition(project.characterVisualLibrary, project.id, {
    document,
    changedKeys,
    visualScopes,
    forceIds,
  });
  const signature = characterCompositionSignature(
    { project, document, baseImage, referenceImage, compositionRequest, changedKeys, visualScopes, forceIds },
    plan,
  );
  ctx.state.compositionSignatures ||= {};
  if (ctx.state.compositionSignatures[prefix] && ctx.state.compositionSignatures[prefix] !== signature) {
    const message =
      'Las piezas o la apariencia cambiaron desde este trabajo. Aplica la selección actual en un trabajo nuevo; la imagen anterior se conserva.';
    throw Object.assign(Error(message), { publicMessage: message, status: 409 });
  }
  ctx.state.compositionSignatures[prefix] = signature;
  ctx.checkpoint();
  if (!baseImage && !plan.steps.length) throw Error('No hay cambios de Outfit pendientes para aplicar.');
  const checked = async (promise) => {
    const result = await promise;
    if (!result || result.status >= 400) {
      const message = result?.body?.error || 'No se pudo preparar la composición.';
      throw Object.assign(Error(message), { publicMessage: message });
    }
    return result.body;
  };
  await checked(helpers.reviewComposition({ body: { projectId: project.id, preflight: true } }));
  ctx.state.compositionAttempts ||= {};
  const attempt = ctx.state.compositionAttempts[prefix] || 0,
    key = prefix + '-' + attempt;
  const original = referenceImage || project.covers?.[project.currentCoverIndex] || project.covers?.[0];
  let image = baseImage || original;
  for (let index = 0; index < plan.steps.length; index++) {
    ctx.progress?.(`Componiendo Outfit · ${index + 1} de ${plan.steps.length}`);
    const step = plan.steps[index],
      compositionStep = {
        items: step.items.map((item, offset) => ({
          id: item.id,
          kind: characterAssetKind(item),
          label: item.label,
          description: item.description,
          image: item.image,
          reference: offset + 2,
          role: item.role,
          layer: item.layer,
        })),
      };
    const direction = await ctx.step(key + '-direction-' + index, () =>
      helpers.localInference
        ? {
            prompt: characterLocalCompositionPrompt(step, {
              removed: index === 0 ? plan.removed : [],
              canonicalReferencePose,
            }),
          }
        : checked(
            helpers.preparePrompt({
              body: {
                projectId: project.id,
                document,
                purpose: 'edit',
                referenceImage: image,
                visualChangeKeys: changedKeys,
                visualScopes,
                compositionForceIds: forceIds,
                compositionStep,
              },
            }),
          ),
    );
    image = await picture(
      key + '-image-' + index,
      direction.prompt,
      [image, ...step.items.map((item) => item.image)],
      helpers.localInference ? { promptReady: true } : undefined,
    );
  }
  const checks = [],
    authorizedKinds = [
      ...new Set([
        ...plan.steps.flatMap((step) =>
          step.items.filter((item) => item.role === 'replace').map(characterAssetKind),
        ),
        ...plan.fieldScopes.map((scope) => scope.kind),
        ...plan.removed.map(characterAssetKind),
      ]),
    ];
  const expectedFields = document.fields
    .filter((field) => field.section === 'appearance' && changedKeys.includes(field.key))
    .map(({ label, value }) => ({ label, value }));
  let preserved = true;
  ctx.state.compositionReviewPending ||= {};
  ctx.state.compositionReviewPending[prefix] = key;
  ctx.checkpoint();
  const roles = new Map(plan.steps.flatMap((step) => step.items.map((item) => [item.id, item.role])));
  const reviewItems = plan.selected.map((item) => ({
    ...item,
    role:
      roles.get(item.id) ||
      (plan.fieldScopes.some((scope) => scope.kind === characterAssetKind(item)) ? 'edit' : 'preserve'),
  }));
  const reviewBatchSize = reviewItems.some((item) => item.role !== 'preserve') ? 6 : 24;
  for (let offset = 0; offset < Math.max(1, reviewItems.length); offset += reviewBatchSize) {
    ctx.progress?.(
      `Comprobando Outfit · ${Math.floor(offset / reviewBatchSize) + 1} de ${Math.max(1, Math.ceil(reviewItems.length / reviewBatchSize))}`,
    );
    let report;
    try {
      report = await ctx.step(key + '-review-v2-' + offset, () =>
        checked(
          helpers.reviewComposition({
            body: {
              projectId: project.id,
              subject: document.identity,
              referenceImage: original,
              candidateImage: image,
              authorizedKinds,
              visualScopes: plan.fieldScopes,
              expectedFields,
              compositionRequest,
              canonicalReferencePose,
              items: reviewItems.slice(offset, offset + reviewBatchSize),
              removedItems: plan.removed.map(({ id, label, description, kind }) => ({
                id,
                label,
                description,
                kind,
              })),
            },
          }),
        ),
      );
    } catch (error) {
      // Make an already paid result recoverable without promoting it or losing its retry checkpoint.
      await retain?.(image);
      throw error;
    }
    preserved &&= report.preserved;
    checks.push(...report.checks);
  }
  // A small local reviewer is unreliable on fine detail (it called grey stripes white and rejected a correct
  // result). For local runs only, a detail mismatch on an accessory or garment that was merely kept does not
  // block. Identity (face, skin, hair, beard...), a requested change that was not applied and any absent
  // piece still do. API reviews keep their full strictness.
  const IDENTITY = new Set([
    'face',
    'skin',
    'hair',
    'beard',
    'eyes',
    'eyebrows',
    'fur',
    'scales',
    'feathers',
  ]);
  const reviewed = new Map(
    reviewItems.map((item) => [item.id, { kind: characterAssetKind(item), role: item.role }]),
  );
  const local = helpers.localInference === true;
  const tolerated = (check) => {
    const meta = reviewed.get(check.id);
    return (
      local &&
      ['mismatch', 'uncertain'].includes(check.status) &&
      Boolean(meta) &&
      ['preserve', 'reapply'].includes(meta.role) &&
      !IDENTITY.has(meta.kind)
    );
  };
  const issues = checks.filter((check) => !['match', 'occluded'].includes(check.status) && !tolerated(check));
  delete ctx.state.compositionReviewPending[prefix];
  ctx.checkpoint();
  // In local runs the per-piece verdicts decide; the model's own overall flag is not trusted on its own.
  if ((!local && !preserved) || issues.length) {
    await reject(image, { preserved, checks });
    ctx.state.compositionAttempts[prefix] = attempt + 1;
    ctx.checkpoint();
    const names = issues
      .map((check) => plan.selected.find((item) => item.id === check.id)?.label)
      .filter(Boolean)
      .slice(0, 4);
    const message =
      'La propuesta no conserva todo el Outfit' +
      (names.length ? ': ' + names.join(', ') : '') +
      '. Se conserva la principal; la propuesta está en la papelera. Reintentar trabajo generará otra composición.';
    throw Object.assign(Error(message), { publicMessage: message });
  }
  return {
    image,
    review: {
      status: 'verified',
      checks: checks.map((check) => ({
        id: check.id,
        slot: characterAssetSlot(plan.selected.find((item) => item.id === check.id)),
        status: tolerated(check) ? 'match' : check.status,
        message: tolerated(check)
          ? `Aviso de la revisión local, no bloquea: ${check.message}`.slice(0, 240)
          : check.message,
      })),
    },
  };
}
module.exports = {
  createCharacterCompositionReviewer,
  runCharacterComposition,
  characterCompositionSignature,
};
