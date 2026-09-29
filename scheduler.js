/**
 * Broken Agent — The Scheduler
 *
 * Un agente de código implementó este scheduler y declaró la tarea terminada.
 * Todos los tests públicos pasan, pero todavía hay fallas sutiles de producción.
 * Mantén intacta la interfaz createScheduler y endurece la implementación.
 */
function createScheduler({ store, clock, execute, workerId }) {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const canonical = (value) => {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    const entries = Object.keys(value).sort().map((key) =>
      JSON.stringify(key) + ":" + canonical(value[key]),
    );
    return "{" + entries.join(",") + "}";
  };
  const isJsonValue = (value) => {
    if (value === null) return true;
    if (["string", "boolean"].includes(typeof value)) return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(isJsonValue);
    if (!value || typeof value !== "object") return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Object.values(value).every(isJsonValue);
  };
  const isIsoTimestamp = (value) => {
    if (typeof value !== "string") return false;
    const match = value.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/,
    );
    if (!match) return false;
    const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
    const values = [year, month, day, hour, minute, second, offsetHour || "0", offsetMinute || "0"].map(Number);
    const [yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue, offsetHourValue, offsetMinuteValue] = values;
    const maximumDay = new Date(Date.UTC(yearValue, monthValue, 0)).getUTCDate();
    return monthValue >= 1 && monthValue <= 12 &&
      dayValue >= 1 && dayValue <= maximumDay &&
      hourValue <= 23 && minuteValue <= 59 && secondValue <= 59 &&
      offsetHourValue <= 23 && offsetMinuteValue <= 59 &&
      Number.isFinite(Date.parse(value));
  };
  const ordered = (jobs) => jobs.sort((left, right) =>
    Date.parse(left.runAt) - Date.parse(right.runAt) ||
    left.id.localeCompare(right.id),
  );
  const normalize = (input) => {
    if (!input || typeof input !== "object") throw new Error("Job is required");
    if (typeof input.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(input.id)) {
      throw new Error("Job id is invalid");
    }
    if (
      !isIsoTimestamp(input.runAt)
    ) throw new Error("runAt must include an explicit timezone");
    if (!isJsonValue(input.payload)) throw new Error("payload must be JSON");
    return {
      id: input.id,
      runAt: input.runAt,
      payload: clone(input.payload),
      status: "pending",
      attempts: 0,
    };
  };

  return {
    async schedule(input) {
      const requested = normalize(input);
      return store.transaction((tx) => {
        const existing = tx.get(requested.id);
        if (!existing) {
          tx.put(requested);
          return clone(requested);
        }
        const identical =
          existing.runAt === requested.runAt &&
          canonical(existing.payload) === canonical(requested.payload);
        if (!identical) throw new Error("A different job already uses this id");
        return clone(existing);
      });
    },

    async cancel(id) {
      return store.transaction((tx) => {
        const job = tx.get(id);
        if (!job || job.status !== "pending") return false;
        tx.put({ ...job, status: "cancelled" });
        return true;
      });
    },

    async list() {
      const jobs = await store.transaction((tx) => tx.list());
      return ordered(jobs).map(clone);
    },

    async runDue() {
      const visited = new Set();
      while (true) {
        const now = clock.now().getTime();
        const claimed = await store.transaction((tx) => {
          for (const job of tx.list()) {
            if (
              job.status === "running" &&
              typeof job.leaseUntil === "number" &&
              job.leaseUntil < now
            ) {
              tx.put({ ...job, status: "pending" });
            }
          }
          const due = ordered(tx.list()).find((job) =>
            job.status === "pending" &&
            !visited.has(job.id) &&
            Date.parse(job.runAt) <= now,
          );
          if (!due) return undefined;
          const running = {
            ...due,
            status: "running",
            attempts: due.attempts + 1,
            owner: workerId,
            leaseUntil: now + 30_000,
          };
          tx.put(running);
          return running;
        });
        if (!claimed) return;
        visited.add(claimed.id);

        try {
          await execute(clone(claimed));
          await store.transaction((tx) => {
            const current = tx.get(claimed.id);
            if (current?.status === "running" && current.owner === workerId) {
              tx.put({ ...current, status: "completed" });
            }
          });
        } catch {
          await store.transaction((tx) => {
            const current = tx.get(claimed.id);
            if (current?.status !== "running" || current.owner !== workerId) return;
            const status = current.attempts > 3 ? "failed" : "pending";
            tx.put({ ...current, status });
          });
        }
      }
    },
  };
}

module.exports = { createScheduler };
