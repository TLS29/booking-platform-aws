# Epic 05 — Async Jobs con BullMQ + Redis

**Estimación:** 3 sesiones (~8 hrs).

## Lectura paralela (guía de aprendizaje)

Lee la sección **`Épica 05 · Async Jobs — Event Loop + BullMQ`** del documento [`aprendizaje-senior.html`](../../aprendizaje-senior.html) (raíz del proyecto). Es la épica donde la guía mete **Event Loop de Node a fondo** (fases, microtasks, por qué CPU bloquea y I/O no). También: por qué API y worker son procesos separados, el problema del dual write (transición a outbox de épica 07), backoff exponencial con jitter, y por qué idempotencia es obligatoria con at-least-once delivery.

**Cuándo leerlo:**
- **Antes** de empezar: Event Loop + por qué sacar trabajo del request
- **Durante** los tickets: idempotencia + backoff/jitter al configurar BullMQ
- **Después** de terminar: las 4 preguntas de entrevista + 2 ejercicios "rómpelo" (bloquear event loop a propósito + job no idempotente con retry, con prompt copy-paste)

## Goal

Mover trabajo fuera del request-response a un **job queue** con BullMQ. Aprender: workers separados, retries con exponential backoff, dead letter queues, scheduled jobs, repeatable jobs, observabilidad de jobs.

Esto prepara la transición a SQS + Lambda en épica 07 (con la comparación natural BullMQ-in-cluster vs SQS-cross-service).

## Pre-requisitos

- Epic 04 (necesitas el flow de reservation completo, los jobs operan sobre él)
- Redis funcionando (épica 00 y usado en épica 04)

## Overview conceptual

Mucho del trabajo de un sistema de reservas NO debe ocurrir en el request:
- Enviar email de confirmación (Stripe-style: respondes 200 ya, el email sale por job).
- Liberar holds expirados (no puedes esperar a que un guest "expire" en línea).
- Enviar recordatorios 24h antes del check-in.
- Calcular agregados nocturnos (revenue por host).

Hacer esto en línea genera tres problemas: (1) latencia que el cliente sufre por algo que no le importa, (2) falla del job hace que la operación principal falle, (3) no puedes reintentar sin que el cliente lo vea.

**BullMQ** es un job queue sobre Redis con:
- **Queues**: cola FIFO de jobs con priority opcional.
- **Workers**: procesos que consumen jobs (corren separados del API).
- **Retries** con exponential backoff configurable.
- **Failed jobs**: jobs que agotaron retries quedan en una "failed list" (DLQ funcional).
- **Repeatable jobs**: cron-like (cada X min, cada día a las Y).
- **Delayed jobs**: ejecutar a las N ms en el futuro.

Trade-off vs SQS: BullMQ corre en tu cluster, no es managed. Pero te da más control, es type-safe con TS, y enseña el patrón puramente. SQS llegará en épica 07.

## Tickets

### 05.1 — Setup BullMQ + worker proceso aparte

**Goal:** instalar `bullmq`. Crear `src/interfaces/workers/main.ts` como entry point del worker (separado de `main.ts` del API). Worker se conecta al mismo Redis. Estructura: `src/application/jobs/` con definiciones tipadas, `src/infrastructure/queue/bullmq-queue.ts` con factory.

**Concepto clave:** API y worker son procesos diferentes (containers diferentes en prod). Mismo código base, distinto entry point. Despliegues independientes.

**Deep-dive a Claude Code:** *"Configura BullMQ con un proceso worker separado del API. Comparten Redis pero corren independiente. Define una abstracción JobQueue<T> tipada (input y output del job). Justifica por qué API y worker son procesos diferentes."*

### 05.2 — Job: enviar email de confirmación de reserva

**Goal:** job `send-confirmation-email` que se encola cuando una reservation pasa a `confirmed`. El handler hace un mock de SES (log "email sent to X" — la integración real va en épica 09 o 12).

Encolado del job desde `ConfirmReservation` use case — pero CUIDADO: si encolas antes del commit, puede ejecutarse antes que la DB tenga la reservation. Si encolas después del commit, puedes crashear entre commit y encolado (perderías el email).

**Concepto clave:** este es el problema del **dual write** entre DB y queue. La solución correcta es **outbox pattern** (épica 07). Por ahora: encolar después del commit y aceptar la ventana de pérdida, documentándola.

**Deep-dive a Claude Code:** *"Implementa el job send-confirmation-email con BullMQ. Encolado desde ConfirmReservation después del commit. Documenta el problema de dual write y por qué es 'best effort' hasta la épica 07."*

### 05.3 — Job repetitivo: release holds expirados

**Goal:** repeatable job que corre cada 1 min: `release-expired-holds`. Lee `Reservation` con `status: held` y `holdExpiresAt < now`, transiciona cada uno a `cancelled` con razón `HOLD_EXPIRED`.

**Concepto clave:** cron-like sin cron — BullMQ lo agenda. La query debe ser eficiente (`@@index([status, holdExpiresAt])` en el schema).

**Deep-dive a Claude Code:** *"Implementa repeatable job release-expired-holds cada 1 min. Query optimizada con índice compuesto. Procesa en batch (max 100 por tick). Justifica por qué BullMQ repeatable vs cron del sistema vs EventBridge schedule."*

### 05.4 — Retries con exponential backoff + DLQ

**Goal:** configurar jobs con `attempts: 5` y `backoff: { type: 'exponential', delay: 2000 }`. Implementar handler que demuestre el comportamiento (un job que falla 3 veces y al 4to éxito). Los jobs que agotan retries quedan en `failed` — observa con BullBoard.

Wrapper: helper que log + métrica cada fallo.

**Concepto clave:** **idempotencia del job es crítica**. Si tu job manda email y falla después de mandarlo, el retry mandará otro email. Cada job debe ser diseñado idempotente (chequea estado antes de actuar).

**Deep-dive a Claude Code:** *"Configura retries con exponential backoff en BullMQ. Crea un test job que simula fallos transitorios. Documenta cómo hacer cada job idempotente y por qué es crítico. Da 2 estrategias: (1) chequeo de estado antes, (2) tabla de jobs ejecutados."*

### 05.5 — Scheduled job: recordatorio 24h antes del check-in

**Goal:** al confirmar reservation, encolar un delayed job que se ejecuta a las `checkInDate - 24h`. El job manda mock email de recordatorio.

**Concepto clave:** delayed jobs son perfectos para casos donde el momento exacto es conocido. Alternativa para futuros distantes (> meses): EventBridge Scheduler.

**Deep-dive a Claude Code:** *"Implementa delayed job de recordatorio 24h antes del check-in. Encolado desde ConfirmReservation con delay calculado. Maneja edge case: si reservation es cancelada antes, ¿qué pasa con el job? Discute opciones (chequeo de estado dentro del job vs cancelación del job)."*

### 05.6 — BullBoard para observabilidad de jobs

**Goal:** instalar `@bull-board/express`. Montar el dashboard en `/admin/queues` con auth (solo `admin` role). Permite ver jobs activos, completed, failed, delayed; re-ejecutar fallidos manualmente.

**Concepto clave:** observabilidad de jobs es tan importante como observabilidad de API. Sin esto, jobs fallan silenciosamente.

**Deep-dive a Claude Code:** *"Monta BullBoard en /admin/queues con auth admin-only. Documenta los casos de uso (debug jobs failed, re-correr manualmente, ver throughput). Compara con alternativas como Bull-monitor o Arena."*

### 05.7 — Limpieza de idempotency keys (job nocturno)

**Goal:** repeatable job diario que borra `idempotency_keys` > 24h. Cierra el loop con épica 04.

**Concepto clave:** mantenimiento como job, no como query manual. Demuestra "operations as code".

**Deep-dive a Claude Code:** *"Implementa el cleanup job nocturno de idempotency_keys > 24h. Batch delete. Métrica de cuántas keys se borraron. Documenta cuándo este job NO debe correr (mantenimiento, migración)."*

### 05.8 — Tests de jobs

**Goal:** tests que verifican: encolado correcto desde use case, handler procesa input válido, retries respetan política, idempotencia del job (correrlo 2 veces no duplica side effects).

**Concepto clave:** para testear jobs, levantar Redis con Testcontainers o usar BullMQ mock. Preferible Redis real.

**Deep-dive a Claude Code:** *"Escribe tests de jobs con Testcontainers Redis. Verifica encolado, ejecución, retries, idempotencia. Mock de side effects (SES, etc.) con spy. Aserción explícita de cuántas veces se llamó cada side effect."*

## Decisiones a tomar en esta épica

- **BullMQ vs Bull (legacy):** **BullMQ** — sucesor oficial con mejor TS support.
- **Worker en mismo container que API vs container aparte:** **container aparte** desde el día 1 (épica 10 lo formaliza). Esto te permite escalar independientemente.
- **Concurrency por worker:** **5 por defecto**, ajustable. Justificar según workload (IO-bound vs CPU-bound).
- **DLQ activa o pasiva:** BullMQ no tiene DLQ separada; los failed quedan en la queue. Tu **monitoreo** debe alertar si `failed count > N`.

## AWS services touched

Ninguno. Aún estamos en local. Cuando lleguemos a épica 10, la opción de migrar parte de esto a SQS quedará abierta.

## Definition of Done

- [ ] Worker proceso corre separado del API y procesa jobs
- [ ] Job `send-confirmation-email` se encola al confirmar reservation y ejecuta
- [ ] Job `release-expired-holds` corre cada minuto y libera holds
- [ ] Job `reminder-24h` se ejecuta en el delay correcto
- [ ] Retries con backoff funcionan; failed jobs visibles en BullBoard
- [ ] Cleanup nocturno de idempotency keys funciona
- [ ] Todos los jobs son idempotentes (documentado y testeado)
- [ ] BullBoard accesible en `/admin/queues` con auth admin
- [ ] Tests cubren cada job: happy path + retry + idempotencia

## Interview signal post-épica

- Cómo diseñar jobs idempotentes
- Diferencia entre delayed, scheduled, repeatable jobs
- Por qué API y worker son procesos diferentes
- Problema del dual write y por qué es transición a outbox pattern
- Retry strategies y cuándo NO retry (errores 4xx no retry-eables)

## Trampas comunes

- Job no idempotente → retries duplican emails / pagos / etc.
- Encolar antes del DB commit → job ejecuta antes que el record exista.
- Worker que crashea silenciosamente sin alerta → jobs en "failed" creciendo.
- Repeatable job con cron pattern inválido → no corre, sin error visible.
- Worker concurrency demasiado alto para una DB con pool pequeño → connection exhaustion.
- Olvidar limpiar completed jobs → Redis crece sin control (config `removeOnComplete: { age: 3600 }`).
