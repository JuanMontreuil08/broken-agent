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
