# Notas

## 2026-09-28 — Traza 1: reinicio con el mismo workerId

Traza: t=0 `w1` (proceso A) toma el job y se cuelga. t=31 s el lease venció y un
proceso nuevo B, también `w1`, lo toma. t=32 s A falla y, como ve `owner === "w1"`,
devuelve el job a pending. t=33 s `w2` lo toma. B y `w2` ejecutan el mismo job a la vez.

Lo que nunca debería pasar:

> un proceso que se cae o queda colgado no debe asumir que por tner su nombre ahi en la
> abse sigue siendo suyo, pues segun la logica otro proceso ya se gatillo y ahora tinee la
> misma tarea.

Versión para el test:

> Un proceso que se cayó o quedó colgado no puede asumir que la tarea sigue siendo suya
> solo porque su nombre aparece en la base de datos, porque otro proceso (incluso con el
> mismo nombre) pudo haberla tomado. Su resultado debe ignorarse.

## 2026-09-29 — Traza 2: cuarta ejecución

Traza: el job falla en su 1.ª, 2.ª y 3.ª ejecución. Tras la 3.ª, `attempts` vale 3 y
`3 > 3` es falso, así que vuelve a pending y se ejecuta una 4.ª vez.

Lo que nunca debería pasar:

> lo inaceptable es que falle en la 3 y siga pending, deberi acambair a failed

## 2026-09-29 — Traza 2b: el 3.er intento se cae sin avisar

Traza: el job falla en su 1.ª y 2.ª ejecución. En la 3.ª el worker se cae o queda
colgado y no avisa. A los 30 s el lease vence, el job vuelve a pending y otro worker lo
ejecuta una 4.ª vez (`attempts` = 4).

Lo que nunca debería pasar:

> no me hace bue nsentido que siga pasando a mas de 3 intntos

Lo que pensé antes de decidir:

> se esta dando la oportundiad de intentat con otro worker hacer el job eso me parece como backup

Decisión:

> ok por el limite entienod el contrto es la fuente de la verdad

> yo pienso que onsiderar tanto failed como casos que el job se quedo colgado consider failed  paa trazabilidad pero omo recuperar ese job?

Riesgo: si el 3.er intento se recupera y termina bien después de que el job quedó
`failed`, el efecto se aplica igual, pero el job sigue `failed`. El registro queda mal;
el servicio se entrega.

> me preocupa que no se entrege el serviio si es que se restablece solo pero nosotro lo marcamos failed

> si dejalo asi y agrega el riesgo a notas

## 2026-09-29 — Traza 3: el lease no vence al alcanzar el deadline

Traza: t=0 `w1` toma el job y se cuelga; su lease dura hasta t=30 s. A los 30 s exactos
`w2` llama a `runDue()`, pero el código compara `30000 < 30000`, que es falso, y no lo
toma. Recién desde t=30,001 s alguien puede tomarlo.

Lo que nunca debería pasar:

> inaceptable que esper mas tiempo de os 30 segundos, en produccion si falla ddeb ser inmediato la recuperacio nsegun el contrato
