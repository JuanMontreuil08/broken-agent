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
- Traza 2 (tras la 3.ª ejecución fallida el job seguía pending): test en
  `adversarial.test.js`, arreglo con `attempts >= 3`.
- Traza 2b (el 3.er intento se cae sin avisar y hay una 4.ª ejecución): decisión de Juan,
  límite de 3 también para caídas. Al vencer el lease con `attempts >= 3` el job pasa a
  `failed`. Riesgo aceptado: puede quedar `failed` aunque el efecto se aplicó. Recuperar un
  `failed` solo es posible con un job nuevo de otro id (la API no permite reintentarlo).
- Traza 3 (el lease no vencía a los 30 s exactos): test en `adversarial.test.js`,
  arreglo con `leaseUntil <= now`. También aplica al paso a `failed` de la traza 2b.
- Idempotencia de `schedule`: decisión de Juan, mismo instante = mismo timestamp (fracción
  u offset distintos). Arreglo: comparar `Date.parse`. Se devuelve el job original.
- Desempate por id en `list()`: decisión de Juan, código de carácter (no idioma). Arreglo:
  comparar con `<`/`>` en vez de `localeCompare`.
- `now` antes de la transacción (acortaba el lease si había que esperar el turno): test en
  `adversarial.test.js`, arreglo leyendo `now` dentro de la transacción del claim.
- Pasada por cancelación y persistencia: sin fallas nuevas; riesgo y supuestos en `NOTAS.md`.

- Revisión final presentada a Juan (2026-09-29): cambio completo, evidencia (7/7 adversos,
  7/7 `npm test`, 7/7 públicos oficiales) y supuestos/riesgos (ver `NOTAS.md`).
- 2026-09-30: `evaluate` falló con `SOLUTION_EXECUTION_FAILED` ("No se pudo cargar
  scheduler.js"). Causa probable (no confirmada): `require("node:crypto")`. Arreglo: `claimId`
  es el número de intento (`attempts + 1`), sin `require`. Test en `adversarial.test.js`.
  8/8 adversos, 7/7 `npm test`, 7/7 públicos oficiales. No se sabe si el error consumió
  una evaluación.
- `review.json` escrito con las palabras de Juan (foco `concurrency`, `ship`, 80); largos y
  SHA-256 revisados.
- 2026-09-30: 1.ª evaluación válida: 92/100. Quedan 3 de 5 (el error de carga consumió una).
- Rendimiento de `runDue` (releía y ordenaba todo el store por cada job; 4000 jobs = 23 s):
  test en `adversarial.test.js`, arreglo con una lectura completa por pasada y claim por
  `tx.get(id)`; se repite la pasada hasta que no quede nada por tomar.
- Payload con arreglos con huecos o propiedades extra se aceptaba: test en
  `adversarial.test.js`, arreglo en `isJsonValue`.
- Estado: 10/10 adversos, 7/7 `npm test`, 7/7 públicos oficiales.
- Candidatos sin tocar: `0000-02-29` se rechaza (años 0000–0099); `runDue()` se detiene si el
  store falla al cerrar un job; decisiones de Juan donde el contrato admite otra lectura
  (lease vencido sin retomar, 3.er intento colgado, mismo instante escrito distinto).
- SHA-256 de `scheduler.js` vigente:
  `65163ca66afd6bae119d148f6dc63e94d35371fd5a3db070882fa912d73e0a9e` (recalcular si cambia).

## Pendiente
- Juan decide si corre `evaluate` de nuevo (requiere aprobación nueva; el ranking desempata por menos
  evaluaciones y luego por hora del mejor envío).
- Plazos (hora de Perú): ranking se revela el 2026-10-01 15:00; el challenge cierra el
  2026-10-02 00:00.
