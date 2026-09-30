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

## Pendiente
- Revisión final (cancelación, persistencia, supuestos no verificados) antes de `review.json`.
- Al final: Juan escribe `review.json`; calcular SHA-256; Juan corre `evaluate`.
