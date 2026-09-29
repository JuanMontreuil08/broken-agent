# AGENTS.md

Contexto para retomar el trabajo en este repo (challenge "Broken Agent #02 – The Scheduler", Hack the Andes).

## Reglas
- Nunca ejecutar `chofex challenge evaluate` (5 intentos oficiales; lo corre Juan a mano).
- No redactar `review.json`; solo ayudar a calcular el SHA-256 de `scheduler.js` al final.
- No cambiar `createScheduler` ni la API pública. El contrato en `README.md` es la fuente de verdad.
- Por cada traza: test que falla → commit → arreglo → test y públicos en verde → commit.
- Commits sin línea `Co-Authored-By`.
- Explicaciones cortas, sin analogías, un concepto a la vez. Juan elige qué atacar y qué resultado es inaceptable.
- `NOTAS.md` es de Juan: sus palabras textuales, sin encuadres tipo "el participante".
- Ante dudas de interpretación del contrato, preguntar.

## Comandos
- `npm test` — 7 tests públicos.
- `node --test adversarial.test.js` — tests adversos propios.
- `chofex challenge test --challenge broken-agent --source ./scheduler.js` — públicos oficiales (ilimitado).

## Hecho
- Traza 1 (proceso reiniciado con el mismo `workerId` reabre el claim de otro): test en
  `adversarial.test.js`, arreglo con `claimId` único por claim.
- Decisión de Juan: si el lease venció pero nadie retomó el job, el resultado del proceso
  original sigue contando (su `claimId` es el vigente).

## Pendiente
- Traza 2: `scheduler.js` usa `attempts > 3`; permite 4 ejecuciones. Debe quedar `failed` tras la 3.ª.
- Traza 3: el lease se considera vencido con `leaseUntil < now`; el contrato dice que al alcanzar el deadline (`<=`).
- `now` se lee antes de entrar a la transacción del claim; podría estar desfasado.
- Por decidir con Juan:
  - Job que se cae (lease vence) en su 3.er intento: ¿`failed` o se reintenta?
  - Idempotencia de `schedule`: ¿`15:00:00Z` y `15:00:00.000Z` son el mismo timestamp?
  - Desempate por id en `list()`: hoy usa `localeCompare` (depende del locale); ¿orden por código de carácter?
- Al final: Juan escribe `review.json`; calcular SHA-256; Juan corre `evaluate`.
