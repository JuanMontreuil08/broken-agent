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
