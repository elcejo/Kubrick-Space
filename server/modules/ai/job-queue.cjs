const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setMaxListeners } = require('node:events');
const { queueTiming, startTiming, finishTiming, timingContext, publicTiming } = require('./job-timing.cjs');

/** Durable FIFO. The runner receives capabilities, never HTTP objects or credentials. */
function createJobQueue({ directory, run, now = () => new Date().toISOString(), stepTimeoutMs = 360000 }) {
  fs.mkdirSync(directory, { recursive: true });
  if (fs.lstatSync(directory).isSymbolicLink())
    throw Error('El directorio de trabajos no puede ser un enlace.');
  const lockFile = path.join(directory, '.owner.json'),
    owner = randomUUID();
  const acquire = () =>
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, owner }), { flag: 'wx', mode: 0o600 });
  try {
    acquire();
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (fs.lstatSync(lockFile).isSymbolicLink()) throw Error('El bloqueo de trabajos no es válido.');
    const previous = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    if (!Number.isSafeInteger(previous.pid) || previous.pid <= 0)
      throw Error('El bloqueo de trabajos requiere revisión.');
    let live = true;
    try {
      process.kill(previous.pid, 0);
    } catch (failure) {
      if (failure.code === 'ESRCH') live = false;
    }
    if (live) throw Error('Ya existe un servidor procesando esta misma cola de trabajos.');
    fs.unlinkSync(lockFile);
    acquire();
  }
  const releaseLock = () => {
    if (fs.existsSync(lockFile) && JSON.parse(fs.readFileSync(lockFile, 'utf8')).owner === owner)
      fs.unlinkSync(lockFile);
  };
  const jobs = new Map();
  const controllers = new Map();
  let processing = false,
    stopped = false;
  const fileFor = (id) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('ID de trabajo inválido.');
    return path.join(directory, id + '.json');
  };
  const persist = (job, { timestamp = true } = {}) => {
    if (timestamp) job.updatedAt = now();
    const file = fileFor(job.id),
      temporary = file + '.' + randomUUID() + '.tmp';
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify(job), 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, file);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  };
  try {
    for (const name of fs.readdirSync(directory).filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))) {
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 8 * 1024 * 1024)
        throw Error('La cola contiene un archivo no permitido.');
      const job = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (
        job.version !== 1 ||
        !Number.isSafeInteger(job.sequence) ||
        job.sequence < 1 ||
        !/^[a-f0-9-]{36}$/.test(job.projectId) ||
        !/^[a-f0-9-]{36}$/.test(job.token) ||
        !job.state ||
        typeof job.state !== 'object' ||
        Array.isArray(job.state) ||
        !job.steps ||
        typeof job.steps !== 'object' ||
        Array.isArray(job.steps) ||
        typeof job.kind !== 'string' ||
        (job.sidebarHidden !== undefined && typeof job.sidebarHidden !== 'boolean') ||
        (job.projectIds !== undefined &&
          (!Array.isArray(job.projectIds) ||
            job.projectIds.length > 49 ||
            job.projectIds.some((id) => !/^[a-f0-9-]{36}$/.test(id)))) ||
        job.kind.length > 80 ||
        fileFor(job.id) !== file ||
        !['queued', 'running', 'completed', 'failed', 'interrupted', 'awaiting_choice', 'cancelled'].includes(
          job.status,
        )
      )
        throw Error('El registro de trabajos no es válido. No se reemplazó.');
      if (job.status === 'running') {
        if (job.timing) {
          finishTiming(job, job.updatedAt || now());
          job.timing.partial = true;
          for (const stage of job.timing.stages || [])
            if (stage.status === 'running') {
              stage.status = 'interrupted';
              stage.finishedAt = job.updatedAt;
              stage.durationMs = Math.max(0, Date.parse(job.updatedAt) - Date.parse(stage.startedAt));
            }
          for (const request of job.timing.requests || [])
            if (request.status === 'running') request.status = 'interrupted';
        }
        job.status = job.inFlight ? 'interrupted' : 'queued';
        if (job.status === 'queued') queueTiming(job, now());
        job.error = job.inFlight
          ? 'El servidor se detuvo durante una llamada al proveedor. Reintenta expresamente; esa llamada podría haberse cobrado.'
          : '';
        persist(job);
      }
      jobs.set(job.id, job);
    }
  } catch (error) {
    releaseLock();
    throw error;
  }
  const active = (projectId) =>
    [...jobs.values()].find(
      (job) =>
        [job.projectId, ...(job.projectIds || [])].includes(projectId) &&
        ['queued', 'running', 'awaiting_choice'].includes(job.status),
    );
  const publicJob = (job, { details = true } = {}) =>
    job && {
      id: job.id,
      projectId: job.projectId,
      projectIds: job.projectIds || [job.projectId],
      kind: job.kind,
      status: job.status,
      sidebarHidden: job.sidebarHidden === true,
      message: job.message,
      error: job.error || '',
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt || null,
      stageStartedAt: job.stageStartedAt || null,
      deadlineAt: job.deadlineAt || null,
      completedSteps: Object.keys(job.steps).length,
      ...(job.state.assetProgress
        ? {
            assetProgress: {
              completed: job.state.assetProgress.completed,
              failed: job.state.assetProgress.failed,
              total: job.state.assetProgress.total,
            },
          }
        : {}),
      timing: publicTiming(job, now(), details),
      result: job.result || null,
      ...(job.kind === 'book'
        ? { progress: job.state.progress || 0, questions: job.state.questions || [] }
        : {}),
      position:
        job.status === 'queued'
          ? [...jobs.values()].filter(
              (j) => ['queued', 'running'].includes(j.status) && j.sequence <= job.sequence,
            ).length
          : 0,
    };
  async function drain() {
    if (processing || stopped) return;
    processing = true;
    try {
      while (!stopped) {
        const job = [...jobs.values()]
          .filter((j) => j.status === 'queued')
          .sort((a, b) => a.sequence - b.sequence)[0];
        if (!job) break;
        job.status = 'running';
        job.startedAt = now();
        startTiming(job, job.startedAt);
        job.error = '';
        persist(job);
        const controller = new AbortController();
        setMaxListeners(256, controller.signal);
        controllers.set(job.id, controller);
        const check = () => controller.signal.throwIfAborted();
        const timing = timingContext(job, {
          now,
          persist: (record) => persist(record, { timestamp: false }),
          writable: () => !stopped || processing,
        });
        const flights = new Map();
        const updateFlights = () => {
          const first = [...flights.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
          job.inFlight = first?.name || '';
          job.stageStartedAt = first?.startedAt || null;
          job.deadlineAt = first?.deadlineAt || null;
        };
        const context = {
          trackRequest: timing.trackRequest,
          claim(projectIds) {
            if (
              !Array.isArray(projectIds) ||
              projectIds.length > 24 ||
              projectIds.some((id) => !/^[a-f0-9-]{36}$/.test(id))
            )
              throw Object.assign(Error('Destinos de personaje inválidos.'), { status: 400 });
            check();
            for (const id of projectIds) {
              const owner = active(id);
              if (owner && owner.id !== job.id)
                throw Object.assign(
                  Error(
                    'Otro trabajo está utilizando uno de los personajes. Espera a que termine y reintenta.',
                  ),
                  { status: 409 },
                );
            }
            job.projectIds = [...new Set([job.projectId, ...(job.projectIds || []), ...projectIds])];
            persist(job);
          },
          signal: controller.signal,
          throwIfAborted: check,
          progress(message) {
            check();
            job.message = message;
            persist(job);
          },
          state: job.state,
          async step(name, operation) {
            check();
            const timeoutMs =
              job.payload.inferenceMode === 'local' ? Math.max(stepTimeoutMs, 30 * 60000) : stepTimeoutMs;
            if (Object.hasOwn(job.steps, name)) {
              timing.reuse();
              return job.steps[name];
            }
            const endStage = timing.begin(name);
            flights.set(name, {
              name,
              startedAt: now(),
              deadlineAt: new Date(Date.now() + timeoutMs).toISOString(),
            });
            updateFlights();
            persist(job);
            let timer, aborted;
            try {
              // Bound even a provider adapter that ignores AbortSignal. Late results cannot checkpoint.
              const halted = new Promise((resolve, reject) => {
                aborted = () => reject(controller.signal.reason);
                controller.signal.addEventListener('abort', aborted, { once: true });
                timer = setTimeout(
                  () =>
                    controller.abort(
                      Object.assign(
                        Error(
                          'La etapa superó el tiempo máximo. Los resultados guardados se conservan; reintenta expresamente.',
                        ),
                        {
                          publicMessage:
                            'La etapa superó el tiempo máximo. Los resultados guardados se conservan; reintenta expresamente.',
                        },
                      ),
                    ),
                  timeoutMs,
                );
              });
              const value = await Promise.race([
                Promise.resolve().then(() => {
                  check();
                  return operation({ trackRequest: endStage.trackRequest });
                }),
                halted,
              ]);
              check();
              job.steps[name] = value ?? null;
              endStage('completed');
              flights.delete(name);
              updateFlights();
              persist(job);
              return value;
            } catch (error) {
              endStage(controller.signal.aborted ? 'cancelled' : 'failed');
              flights.delete(name);
              updateFlights();
              persist(job);
              throw error;
            } finally {
              clearTimeout(timer);
              controller.signal.removeEventListener('abort', aborted);
            }
          },
          checkpoint() {
            check();
            persist(job);
          },
        };
        try {
          job.result = await run(job, context);
          check();
          job.status = job.result?.awaitingChoice ? 'awaiting_choice' : 'completed';
          job.message = job.result?.message || 'Trabajo completado.';
        } catch (error) {
          job.status = job.status === 'cancelled' ? 'cancelled' : 'failed';
          job.error =
            job.status === 'cancelled'
              ? ''
              : error.publicMessage ||
                (error.status && error.status < 500
                  ? error.message
                  : 'No se pudo completar esta etapa. Lo ya guardado se conserva; puedes reintentar.');
          job.message =
            job.status === 'cancelled'
              ? 'Cancelado. Los resultados ya guardados se conservan.'
              : 'Trabajo detenido; resultados parciales guardados.';
        }
        controllers.delete(job.id);
        job.inFlight = '';
        job.deadlineAt = null;
        finishTiming(job, now());
        if (job.status === 'awaiting_choice') job.timing.finishedAt = null;
        persist(job);
      }
    } finally {
      processing = false;
    }
  }
  const schedule = () => {
    queueMicrotask(
      () =>
        void drain().catch((error) => {
          stopped = true;
          console.error('[Jobs] Cola detenida por error de almacenamiento:', error.code || 'storage');
        }),
    );
  };
  function enqueue({ projectId, kind, token, payload }) {
    if (stopped)
      throw Object.assign(Error('La cola está detenida. Revisa el almacenamiento del servidor.'), {
        status: 503,
      });
    const duplicate = [...jobs.values()].find((j) => j.projectId === projectId && j.token === token);
    if (duplicate) return publicJob(duplicate);
    if (active(projectId))
      throw Object.assign(Error('Este proyecto ya tiene un trabajo pendiente.'), { status: 409 });
    if ([...jobs.values()].filter((j) => ['queued', 'running'].includes(j.status)).length >= 100)
      throw Object.assign(Error('La cola está llena.'), { status: 429 });
    const job = {
      version: 1,
      id: randomUUID(),
      projectId,
      kind,
      token,
      payload,
      sequence: Math.max(0, ...[...jobs.values()].map((j) => j.sequence)) + 1,
      status: 'queued',
      message: 'En cola',
      error: '',
      createdAt: now(),
      steps: {},
      state: {},
      inFlight: '',
    };
    queueTiming(job, job.createdAt);
    persist(job);
    jobs.set(job.id, job);
    schedule();
    return publicJob(job);
  }
  function retry(id) {
    const job = jobs.get(id);
    if (!job || !['failed', 'interrupted'].includes(job.status))
      throw Object.assign(Error('No hay una etapa fallida para reintentar.'), { status: 409 });
    if (active(job.projectId)) throw Object.assign(Error('El proyecto ya está ocupado.'), { status: 409 });
    job.status = 'queued';
    queueTiming(job, now());
    job.error = '';
    job.sequence = Math.max(0, ...[...jobs.values()].map((j) => j.sequence)) + 1;
    persist(job);
    schedule();
    return publicJob(job);
  }
  function cancel(id) {
    const job = jobs.get(id);
    if (!job) throw Object.assign(Error('Trabajo no encontrado.'), { status: 404 });
    if (job.status === 'cancelled') return publicJob(job);
    if (!['queued', 'running', 'awaiting_choice'].includes(job.status))
      throw Object.assign(Error('Este trabajo ya terminó.'), { status: 409 });
    job.status = 'cancelled';
    finishTiming(job, now());
    job.error = '';
    job.message = 'Cancelado. Los resultados ya guardados se conservan.';
    persist(job);
    controllers.get(id)?.abort(Object.assign(Error('Trabajo cancelado.'), { code: 'JOB_CANCELLED' }));
    return publicJob(job);
  }
  function dismiss(id) {
    const job = jobs.get(id);
    if (!job) throw Object.assign(Error('Trabajo no encontrado.'), { status: 404 });
    job.sidebarHidden = true;
    persist(job, { timestamp: false });
    return publicJob(job);
  }
  function remove(id) {
    const job = jobs.get(id);
    if (!job) throw Object.assign(Error('Trabajo no encontrado.'), { status: 404 });
    if (['queued', 'running', 'awaiting_choice'].includes(job.status) || controllers.has(id))
      throw Object.assign(Error('Espera a que termine la tarea para eliminar su registro.'), { status: 409 });
    fs.unlinkSync(fileFor(id));
    jobs.delete(id);
  }
  schedule();
  return {
    enqueue,
    retry,
    cancel,
    dismiss,
    remove,
    active,
    get: (id) => jobs.get(id),
    publicJob,
    list: (projectId) =>
      [...jobs.values()]
        .filter((j) => !projectId || [j.projectId, ...(j.projectIds || [])].includes(projectId))
        .sort((a, b) => b.sequence - a.sequence)
        .map((job) => publicJob(job, { details: false })),
    update(job) {
      persist(job);
    },
    resume(job) {
      job.status = 'queued';
      queueTiming(job, now());
      persist(job);
      schedule();
    },
    stop() {
      stopped = true;
      if (!processing) {
        releaseLock();
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        const check = () => {
          if (!processing) {
            releaseLock();
            resolve();
          } else setTimeout(check, 10);
        };
        check();
      });
    },
    idle: () => !processing && ![...jobs.values()].some((j) => j.status === 'queued'),
  };
}
module.exports = { createJobQueue };
