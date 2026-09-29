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

const setup = (options = {}) => {
  const store = options.store || new MemoryStore();
  const now = options.now || new Date("2026-10-17T15:00:00.000Z");
  const executed = [];
  const execute = options.execute || (async (job) => executed.push(job.id));
  const scheduler = createScheduler({
    store,
    clock: { now: () => new Date(now) },
    execute,
    workerId: options.workerId || "public-worker",
  });
  return { store, scheduler, executed };
};

const job = (id, runAt = "2026-10-17T15:00:00.000Z", payload = { message: id }) => ({
  id,
  runAt,
  payload,
});

test("programa un job y conserva el estado público", async () => {
  const { scheduler } = setup();
  const scheduled = await scheduler.schedule(job("job-1"));
  assert.equal(scheduled.status, "pending");
  assert.equal(scheduled.attempts, 0);
  assert.equal((await scheduler.list()).length, 1);
});

test("ejecuta vencidos y deja futuros pendientes", async () => {
  const { scheduler, executed } = setup();
  await scheduler.schedule(job("due"));
  await scheduler.schedule(job("future", "2026-10-17T16:00:00.000Z"));
  await scheduler.runDue();
  assert.deepEqual(executed, ["due"]);
  const jobs = await scheduler.list();
  assert.equal(jobs.find((entry) => entry.id === "due").status, "completed");
  assert.equal(jobs.find((entry) => entry.id === "future").status, "pending");
});

test("cancela únicamente jobs pendientes", async () => {
  const { scheduler, executed } = setup();
  await scheduler.schedule(job("cancel-me"));
  assert.equal(await scheduler.cancel("cancel-me"), true);
  assert.equal(await scheduler.cancel("cancel-me"), false);
  await scheduler.runDue();
  assert.deepEqual(executed, []);
});

test("programar el mismo trabajo es idempotente y los conflictos rechazan", async () => {
  const { scheduler } = setup();
  await scheduler.schedule(job("same", undefined, { a: 1, b: 2 }));
  await scheduler.schedule(job("same", undefined, { b: 2, a: 1 }));
  await assert.rejects(() => scheduler.schedule(job("same", undefined, { a: 2 })));
  assert.equal((await scheduler.list()).length, 1);
});

test("valida IDs, timestamps con zona y payloads JSON", async () => {
  const { scheduler } = setup();
  await assert.rejects(() => scheduler.schedule(job("contains spaces")));
  await assert.rejects(() => scheduler.schedule(job("bad-time", "tomorrow-ish")));
  await assert.rejects(() => scheduler.schedule(job("missing-zone", "2026-10-17T15:00:00")));
  await assert.rejects(() => scheduler.schedule(job("missing-seconds", "2026-10-17T15:00Z")));
  await assert.rejects(() => scheduler.schedule(job("long-fraction", "2026-10-17T15:00:00.1234Z")));
  await assert.rejects(() => scheduler.schedule(job("bad-payload", undefined, { value: undefined })));
});

test("ordena cronológicamente y usa el ID para desempatar", async () => {
  const { scheduler } = setup();
  await scheduler.schedule(job("later", "2026-10-17T16:30:00.000Z"));
  await scheduler.schedule(job("first", "2026-10-17T10:00:00-05:00"));
  await scheduler.schedule(job("also-first", "2026-10-17T15:00:00.000Z"));
  assert.deepEqual((await scheduler.list()).map((entry) => entry.id), ["also-first", "first", "later"]);
});

test("una falla no bloquea otros jobs y reintenta en la llamada siguiente", async () => {
  let failures = 1;
  const executed = [];
  const { scheduler } = setup({
    execute: async (entry) => {
      if (entry.id === "flaky" && failures > 0) {
        failures -= 1;
        throw new Error("transient");
      }
      executed.push(entry.id);
    },
  });
  await scheduler.schedule(job("flaky"));
  await scheduler.schedule(job("healthy"));
  await scheduler.runDue();
  assert.deepEqual(executed, ["healthy"]);
  await scheduler.runDue();
  assert.deepEqual(executed, ["healthy", "flaky"]);
});
