# Broken Agent — The Scheduler

> Un agente de código dice que terminó. Todos los tests públicos pasan. Tu
> trabajo es decidir si realmente lo enviarías a producción y repararlo.

Repara `scheduler.js` sin cambiar la interfaz exportada
`createScheduler(dependencies)`.

## Comandos

```sh
npm test
chofex challenge test --challenge broken-agent --source ./scheduler.js
chofex challenge evaluate --challenge broken-agent --source ./scheduler.js --review ./review.json
```

Los tests locales y públicos son ilimitados. Tienes **5 evaluaciones oficiales**
contra escenarios ocultos. Las herramientas de AI están permitidas, pero este es
un challenge de colaboración: el agente implementa y el participante toma las
decisiones de ingeniería.

Los challenges técnicos son obligatorios para competir por un cupo. Enviar la
postulación solo crea tu candidatura: no reserva una plaza. Los mejores
resultados de los rankings serán seleccionados para el evento.

## Protocolo humano–agente

No le pidas al agente que resuelva todo en silencio. Antes de modificar el
scheduler, el agente debe presentarte al menos tres trazas de falla concretas del
starter. Tú eliges cuál investigar primero y explicas qué resultado nunca debería
ocurrir. El agente convierte esa decisión en una prueba y luego implementa.

Cuando los tests estén verdes, el agente debe enseñarte el cambio, la evidencia y
los supuestos que todavía no verificó. La evaluación oficial requiere
`review.json` con tus propias palabras:

- `focus`: `concurrency`, `persistence`, `lease_recovery`,
  `retry_idempotency`, `regression_safety` o `performance`;
- `sourceDigest`: SHA-256 de `scheduler.js` para vincular el juicio al cambio
  exacto (el agente puede calcular este valor mecánico);
- `failureScenario`: una secuencia concreta de eventos y su resultado
  incorrecto;
- `evidence`: la prueba o inspección que revisaste y qué demostró;
- `decision`: `ship` o `block`;
- `confidence`: un entero de 0 a 100;
- `remainingRisk`: el riesgo que aceptas o que todavía bloquea el release.

Forma del archivo (reemplaza cada valor entre <...>):

```json
{
  "sourceDigest": "<sha256 de scheduler.js>",
  "focus": "<área elegida>",
  "failureScenario": "<tu traza concreta>",
  "evidence": "<la evidencia que revisaste>",
  "decision": "<ship o block>",
  "confidence": 0,
  "remainingRisk": "<el riesgo que queda>"
}
```

Cada respuesta de texto debe tener entre 20 y 1,000 caracteres. El agente puede
explicar, debatir y guardar tus respuestas, pero no puede elegir el foco, inventar
tu razonamiento ni tomar la decisión de release por ti. Si cambias
`scheduler.js`, vuelve a revisar la evidencia antes de reemplazar el review.

La primera ejecución de `challenge evaluate` crea un enlace corto de
aprobación y **no consume** una evaluación. Abre ese enlace en tu computadora,
revisa el review vinculado al SHA-256 exacto y confirma con Windows Hello,
Touch ID, PIN del equipo o una llave de seguridad. Google Workspace puede
bloquear las passkeys del teléfono: no uses el código QR. Después repite el
mismo comando para ejecutar la evaluación oficial. Cada evaluación requiere una
aprobación nueva; la sesión OAuth del CLI no puede aprobarla.

## Contrato normativo

`createScheduler({ store, clock, execute, workerId })` devuelve:

- `schedule({ id, runAt, payload })`
- `cancel(id)`
- `list()`
- `runDue()`

### Jobs y valores de retorno

- `id` cumple `^[A-Za-z0-9_-]{1,64}$`.
- `runAt` usa el perfil ISO-8601
  `YYYY-MM-DDTHH:mm:ss[.SSS](Z|±HH:mm)`: los segundos y la zona son
  obligatorios, y la fracción opcional admite entre uno y tres dígitos.
- `payload` es un valor JSON estricto: null, boolean, string, número finito,
  arreglo u objeto compuesto únicamente por otros valores JSON.
- Los timestamps pasados son válidos y quedan vencidos inmediatamente.
- `schedule()` persiste y devuelve el job. Programar el mismo ID, timestamp y
  payload JSON estructuralmente equivalente es idempotente. Reutilizar un ID
  para otro trabajo debe rechazar sin cambiar el job original.
- `cancel()` devuelve true solo cuando cambia un job pendiente a cancelado.
  Un job running, completed, failed o inexistente no puede cancelarse.
- `list()` devuelve todos los jobs ordenados cronológicamente por `runAt` y,
  ante empate, por `id`. Como mínimo expone `id`, `runAt`, `payload`,
  `status` y `attempts`.

### Estado, concurrencia y recuperación

- Los estados son `pending`, `running`, `completed`, `failed` y
  `cancelled`. Los jobs nuevos empiezan pending con cero intentos.
- El store sobrevive nuevas instancias del scheduler y reinicios del proceso.
- Varios workers, incluso instancias que reutilizan un `workerId` después de
  reiniciar, pueden llamar `runDue()` contra el mismo store.
- `runDue()` reclama un job antes de llamar al executor. Un job que falla
  queda pendiente para una llamada posterior y no bloquea otros jobs.
- Cada ejecución debe reclamarse atómicamente. El claim dura 30 segundos.
  Cuando `clock.now()` alcanza ese deadline, otro worker puede reclamar el
  job. Un worker que ya no es dueño del claim, incluido un proceso que vuelve
  con el mismo `workerId`, no puede completarlo, marcarlo como fallido ni
  reabrirlo.
- Un intento se cuenta al reclamar el job. Después de 3 ejecuciones fallidas el
  job queda failed.
- `execute(job)` puede fallar antes o después de aplicar el efecto. El adapter
  aplica efectos idempotentemente por job ID, por lo que reintentar debe llevar
  el job a completed sin duplicar el efecto. No se promete exactly-once para
  efectos arbitrarios.
- `runDue()` resuelve cuando ya procesó todos los jobs que podía reclamar en
  esa llamada. No mantiene una transacción abierta mientras ejecuta un job.

El store expone solo `transaction(action)`. Dentro de una acción, `tx`
ofrece operaciones síncronas `get(id)`, `put(job)`, `delete(id)` y
`list()`. Las transacciones están serializadas. `clock.now()` devuelve un
`Date`; `execute(job)` devuelve una promesa.

## Evaluación

El evaluador usa variantes determinísticas por participante. El veredicto
oficial es un solo puntaje sobre 100. No incluye casos ocultos, un desglose por
capacidad ni un costo de ejecución.

El ranking exige una postulación enviada o revisada. Ordena por puntaje total,
luego por menos evaluaciones oficiales y, al final, por la hora del mejor
envío. Todos los puntajes válidos aparecen en el ranking.
