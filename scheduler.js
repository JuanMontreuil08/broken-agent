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
    // Por código de carácter: el orden no depende del idioma del sistema.
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
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
          // Mismo instante aunque se escriba distinto (fracción u offset).
          Date.parse(existing.runAt) === Date.parse(requested.runAt) &&
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
        const claimed = await store.transaction((tx) => {
          // La hora se lee dentro de la transacción: si hubo que esperar el turno,
          // el lease igual dura 30 s desde que se toma el job.
          const now = clock.now().getTime();
          for (const job of tx.list()) {
            if (
              job.status === "running" &&
              typeof job.leaseUntil === "number" &&
              job.leaseUntil <= now
            ) {
              // Un intento se cuenta al reclamar: si el 3.º se cayó sin avisar,
              // el job no se vuelve a ejecutar.
              tx.put({ ...job, status: job.attempts >= 3 ? "failed" : "pending" });
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
            // Identifica este claim en particular: un proceso que reinicia con el
            // mismo workerId no debe poder cerrar el claim de otra ejecución.
            // Es el número de intento: sube en cada claim, dentro de la transacción.
            claimId: due.attempts + 1,
            leaseUntil: now + 30_000,
          };
          tx.put(running);
          return running;
        });
        if (!claimed) return;
        visited.add(claimed.id);
        const ownsClaim = (current) =>
          current?.status === "running" && current.claimId === claimed.claimId;

        try {
          await execute(clone(claimed));
          await store.transaction((tx) => {
            const current = tx.get(claimed.id);
            if (ownsClaim(current)) {
              tx.put({ ...current, status: "completed" });
            }
          });
        } catch {
          await store.transaction((tx) => {
            const current = tx.get(claimed.id);
            if (!ownsClaim(current)) return;
            const status = current.attempts >= 3 ? "failed" : "pending";
            tx.put({ ...current, status });
          });
        }
      }
    },
  };
}

module.exports = { createScheduler };
