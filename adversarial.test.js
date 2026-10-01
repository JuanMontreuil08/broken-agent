const test = require("node:test");
const assert = require("node:assert/strict");
const { createScheduler } = require("./scheduler.js");

const clone = (value) => {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
};

class MemoryStore {
  constructor() {
    this.jobs = new Map();
    this.tail = Promise.resolve();
  }

  transaction(action) {
    const run = this.tail.then(() => action({
      get: (id) => clone(this.jobs.get(id)),
      put: (job) => {
        this.jobs.set(job.id, clone(job));
        return clone(job);
      },
      delete: (id) => this.jobs.delete(id),
      list: () => [...this.jobs.values()].map(clone),
    }));
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
}

const START = Date.parse("2026-10-17T15:00:00.000Z");
const seconds = (value) => START + value * 1000;

// Reloj compartido que el test avanza a mano.
const createClock = () => {
  const clock = { time: START, now: () => new Date(clock.time) };
  return clock;
};

// Promesa que el test resuelve o rechaza desde afuera.
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

// Executor que queda bloqueado hasta que el test decide cómo termina.
const blockingExecutor = () => {
  const started = deferred();
  const finish = deferred();
  const calls = [];
  const execute = (job) => {
    calls.push(job);
    started.resolve(job);
    return finish.promise;
  };
  return { execute, started: started.promise, finish, calls };
};

const job = { id: "job-1", runAt: "2026-10-17T15:00:00.000Z", payload: { n: 1 } };

// Un proceso que se cayó o quedó colgado no puede asumir que la tarea sigue siendo
// suya solo porque su nombre aparece en la base de datos, porque otro proceso
// (incluso con el mismo nombre) pudo haberla tomado. Su resultado debe ignorarse.
test("traza 1: un proceso viejo con el mismo workerId no puede reabrir el claim del nuevo", async () => {
  const store = new MemoryStore();
  const clock = createClock();

  // t=0: proceso A (w1) toma el job y queda colgado.
  const executorA = blockingExecutor();
  const processA = createScheduler({ store, clock, execute: executorA.execute, workerId: "w1" });
  await processA.schedule(job);
  const runA = processA.runDue();
  await executorA.started;

  // t=31: el lease venció; proceso B (reinicio, también w1) toma el job.
  clock.time = seconds(31);
  const executorB = blockingExecutor();
  const processB = createScheduler({ store, clock, execute: executorB.execute, workerId: "w1" });
  const runB = processB.runDue();
  await executorB.started;

  // t=32: A despierta con error. Su resultado debe ignorarse.
  clock.time = seconds(32);
  executorA.finish.reject(new Error("A falló tarde"));
  await runA;

  const afterA = (await processB.list()).find((entry) => entry.id === job.id);
  assert.equal(afterA.status, "running", "el job debe seguir running en manos de B");
  assert.equal(afterA.attempts, 2);

  // t=33: w2 no debe poder tomar un job que B sigue ejecutando.
  clock.time = seconds(33);
  const executorC = blockingExecutor();
  const processC = createScheduler({ store, clock, execute: executorC.execute, workerId: "w2" });
  await processC.runDue();
  assert.equal(executorC.calls.length, 0, "w2 no debe ejecutar el job mientras B lo tiene");

  // B termina bien: el job queda completed.
  executorB.finish.resolve();
  await runB;
  const final = (await processB.list()).find((entry) => entry.id === job.id);
  assert.equal(final.status, "completed");
});

// Lo inaceptable es que falle en la 3.ª ejecución y siga pending: debe cambiar a failed.
test("traza 2: tras la 3.ª ejecución fallida el job queda failed y no se ejecuta una 4.ª", async () => {
  const store = new MemoryStore();
  const clock = createClock();
  const calls = [];
  const execute = async (entry) => {
    calls.push(entry.id);
    throw new Error("falla siempre");
  };
  const scheduler = createScheduler({ store, clock, execute, workerId: "w1" });
  await scheduler.schedule(job);

  for (let run = 1; run <= 3; run += 1) {
    await scheduler.runDue();
  }

  const afterThird = (await scheduler.list()).find((entry) => entry.id === job.id);
  assert.equal(afterThird.attempts, 3);
  assert.equal(afterThird.status, "failed", "tras 3 ejecuciones fallidas debe quedar failed");

  await scheduler.runDue();
  assert.equal(calls.length, 3, "no debe haber una 4.ª ejecución");
});

// No tiene sentido que un job pase de 3 intentos: si el 3.º se cae sin avisar,
// el job queda failed en vez de ejecutarse una 4.ª vez.
test("traza 2b: si el 3.er intento se cae sin avisar, el job queda failed y no hay 4.ª ejecución", async () => {
  const store = new MemoryStore();
  const clock = createClock();
  const calls = [];
  const failing = async (entry) => {
    calls.push(entry.id);
    throw new Error("falla");
  };

  // Intentos 1 y 2: fallan y avisan.
  const worker1 = createScheduler({ store, clock, execute: failing, workerId: "w1" });
  await worker1.schedule(job);
  await worker1.runDue();
  await worker1.runDue();

  // Intento 3: el proceso queda colgado y nunca avisa.
  const hung = blockingExecutor();
  const worker2 = createScheduler({
    store,
    clock,
    execute: (entry) => {
      calls.push(entry.id);
      return hung.execute(entry);
    },
    workerId: "w2",
  });
  worker2.runDue();
  await hung.started;

  // t=31: el lease venció; otro worker no debe ejecutarlo una 4.ª vez.
  clock.time = seconds(31);
  const worker3 = createScheduler({ store, clock, execute: failing, workerId: "w3" });
  await worker3.runDue();

  assert.equal(calls.length, 3, "no debe haber una 4.ª ejecución");
  const final = (await worker3.list()).find((entry) => entry.id === job.id);
  assert.equal(final.attempts, 3);
  assert.equal(final.status, "failed");
});

// Es inaceptable que espere más de los 30 segundos: si falla, la recuperación debe
// ser inmediata al llegar al deadline.
test("traza 3: a los 30 s exactos otro worker puede tomar el job", async () => {
  const store = new MemoryStore();
  const clock = createClock();

  // t=0: w1 toma el job y queda colgado.
  const hung = blockingExecutor();
  const worker1 = createScheduler({ store, clock, execute: hung.execute, workerId: "w1" });
  await worker1.schedule(job);
  worker1.runDue();
  await hung.started;

  // t=30 s exactos: el lease alcanzó su deadline; w2 debe poder tomarlo.
  clock.time = seconds(30);
  const calls = [];
  const worker2 = createScheduler({
    store,
    clock,
    execute: async (entry) => { calls.push(entry.id); },
    workerId: "w2",
  });
  await worker2.runDue();

  assert.equal(calls.length, 1, "w2 debe ejecutar el job al alcanzar el deadline");
  const final = (await worker2.list()).find((entry) => entry.id === job.id);
  assert.equal(final.status, "completed");
});

// Debe homologar: no puede fallar por formas diferentes en que se escribe o expresa
// el mismo instante.
test("idempotencia: el mismo instante escrito de otra forma no se rechaza", async () => {
  const store = new MemoryStore();
  const clock = createClock();
  const scheduler = createScheduler({ store, clock, execute: async () => {}, workerId: "w1" });
  await scheduler.schedule(job);

  for (const runAt of [
    "2026-10-17T15:00:00Z",
    "2026-10-17T15:00:00.0Z",
    "2026-10-17T10:00:00.00-05:00",
    "2026-10-17T15:00:00+00:00",
  ]) {
    const result = await scheduler.schedule({ ...job, runAt });
    assert.equal(result.runAt, job.runAt, `${runAt} debe devolver el job original`);
  }
  assert.equal((await scheduler.list()).length, 1);

  // Un instante distinto con el mismo id se sigue rechazando.
  await assert.rejects(scheduler.schedule({ ...job, runAt: "2026-10-17T15:00:00.001Z" }));
});

// El orden no puede depender del idioma del sistema: ante empate de runAt se ordena
// por código de carácter del id.
test("list: ante empate de runAt, ordena por código de carácter del id", async () => {
  const store = new MemoryStore();
  const clock = createClock();
  const scheduler = createScheduler({ store, clock, execute: async () => {}, workerId: "w1" });
  for (const id of ["b", "job_1", "B", "a", "job-2", "A"]) {
    await scheduler.schedule({ ...job, id });
  }

  const ids = (await scheduler.list()).map((entry) => entry.id);
  assert.deepEqual(ids, ["A", "B", "a", "b", "job-2", "job_1"]);
});

// Es inaceptable que el worker pierda tiempo de su lease por esperar su turno en la base
// de datos: los 30 s deben contar desde que toma el job, o se solapa con otro worker que
// ya lo ve vencido a los 30 s.
test("now: el lease cuenta desde que se toma el job, no desde antes de esperar la transacción", async () => {
  const store = new MemoryStore();
  const clock = createClock();
  const hung = blockingExecutor();
  const worker1 = createScheduler({ store, clock, execute: hung.execute, workerId: "w1" });
  await worker1.schedule(job);

  // La base de datos está ocupada: la próxima transacción espera 5 s antes de correr.
  const transaction = store.transaction.bind(store);
  store.transaction = (action) => {
    store.transaction = transaction;
    return transaction((tx) => {
      clock.time = seconds(5);
      return action(tx);
    });
  };

  // t=0: w1 pide el claim; recién a t=5 s lo obtiene.
  worker1.runDue();
  await hung.started;

  // t=30 s: w1 lleva solo 25 s con el job; w2 no debe poder tomarlo.
  clock.time = seconds(30);
  const calls = [];
  const worker2 = createScheduler({
    store,
    clock,
    execute: async (entry) => { calls.push(entry.id); },
    workerId: "w2",
  });
  await worker2.runDue();

  assert.equal(calls.length, 0, "w2 no debe ejecutar el job mientras w1 sigue dentro de sus 30 s");
});

test("carga: scheduler.js no usa require ni import", () => {
  const source = require("node:fs").readFileSync(require.resolve("./scheduler.js"), "utf8");
  assert.doesNotMatch(source, /\brequire\s*\(|^\s*import\s/m, "el evaluador no carga scheduler.js si usa dependencias");
});

test("rendimiento: runDue no vuelve a leer todo el store por cada job", async () => {
  const store = new MemoryStore();
  const clock = createClock();
  const executed = [];
  const scheduler = createScheduler({
    store,
    clock,
    execute: async (entry) => { executed.push(entry.id); },
    workerId: "w1",
  });
  const total = 50;
  for (let index = 0; index < total; index += 1) {
    await scheduler.schedule({ ...job, id: `job-${index}` });
  }

  // Cuenta las lecturas completas del store durante runDue.
  let lists = 0;
  const transaction = store.transaction.bind(store);
  store.transaction = (action) => transaction((tx) =>
    action({ ...tx, list: () => { lists += 1; return tx.list(); } }));
  await scheduler.runDue();

  assert.equal(executed.length, total, "debe ejecutar todos los jobs vencidos");
  assert.ok(lists <= 5, `runDue leyó el store completo ${lists} veces para ${total} jobs`);
});

test("payload: un arreglo con huecos o con propiedades extra no es JSON estricto", async () => {
  const scheduler = createScheduler({
    store: new MemoryStore(),
    clock: createClock(),
    execute: async () => {},
    workerId: "w1",
  });
  await assert.rejects(() => scheduler.schedule({ ...job, id: "hueco", payload: [1, , 3] }));
  await assert.rejects(() => scheduler.schedule({ ...job, id: "anidado", payload: { lista: new Array(2) } }));
  const extra = [1, 2];
  extra.nota = "x";
  await assert.rejects(() => scheduler.schedule({ ...job, id: "extra", payload: extra }));
  assert.equal((await scheduler.list()).length, 0);
});
