# Epic 04 — Reservations: Concurrencia + State Machine + Idempotency

**Estimación:** 5 sesiones (~12 hrs). **Es la épica más densa y más importante del proyecto para interview.**

## Lectura paralela (guía de aprendizaje)

Lee la sección **`Épica 04 · Reservations`** del documento [`aprendizaje-senior.html`](../../aprendizaje-senior.html) (raíz del proyecto). Cubre:

- Los 4 approaches a concurrencia (optimistic, pessimistic, distributed lock, hold con TTL) y cuándo cada uno
- State machines explícitas y por qué viven en domain
- Idempotency a fondo (patrón Stripe, hash del body)
- 4 ejercicios **"rómpelo a propósito"** con prompt copy-paste para practicar en una sesión separada
- 5 preguntas de entrevista con esqueleto de respuesta
- Gotchas comunes que debes reconocer al instante

**Cuándo leerlo:**
- **Antes** de empezar: la sección "el problema central" y "las 4 aproximaciones"
- **Durante** los tickets: los gotchas relevantes a lo que estés haciendo
- **Después** de terminar: las preguntas de entrevista (intenta responder en voz alta) y los ejercicios "rómpelo" para validar que entendiste

## Goal

Implementar el corazón del negocio: que un guest pueda hacer una reservación de forma **correcta bajo concurrencia**. Aquí se materializan los conceptos que diferencian senior de mid:

- **Race conditions reales** (dos guests, mismo slot, al mismo tiempo)
- **Distributed locks** con Redis (Redlock o pattern propio)
- **Pessimistic locking en Postgres** (`SELECT ... FOR UPDATE`) como alternativa
- **State machines** explícitas con transiciones validadas
- **Idempotency-Key** para tolerar retries del cliente
- **Optimistic locking** con version columns

Si ya hiciste esta épica y la puedes defender, puedes contestar 60% de las preguntas de system design senior. Tómate el tiempo.

## Pre-requisitos

- Epic 01 (persistence con `version` columns)
- Epic 02 (auth para identificar al guest)
- Epic 03 (listings, para reservar contra un listing)

## Overview conceptual

El problema central: **dos guests intentan reservar el mismo listing para las mismas fechas al mismo tiempo**. Sin protección, ambos creen que reservaron, y tu sistema queda en estado inválido.

Aproximaciones para resolverlo, de más simple a más correcta:

### Aproximación 1: Optimistic locking
Cada `Listing` tiene `version`. Update incluye `WHERE version = X`. Si dos clientes corren `UPDATE listings SET version = X+1 WHERE id = ? AND version = X`, solo uno tiene éxito (1 row affected); el otro tiene 0 row affected y reintentas o fallas.

**Cuándo sirve:** baja contención. Mata performance bajo alta contención (cada conflicto requiere retry).

### Aproximación 2: Pessimistic locking con `SELECT FOR UPDATE`
Dentro de la transacción: `SELECT * FROM listings WHERE id = ? FOR UPDATE` bloquea la row hasta commit/rollback. El segundo cliente espera. Funciona, pero serializa el endpoint y no escala cross-service.

**Cuándo sirve:** transacciones cortas, contención esperada en una sola DB.

### Aproximación 3: Distributed lock en Redis
Antes de tocar DB, `SET lock:listing:{id} <random> NX EX 10` (atomic). Si tienes el lock, procedes. Si no, esperas o fallas. Liberas con script Lua que solo borra si el valor coincide (evita borrar el lock de otro).

**Cuándo sirve:** cross-service, lock granular, latencia menor que DB locks.

**Trampas:** Redis no es CP. Si el master cae y el slave no había replicado el lock, dos clientes pueden tener el "mismo" lock. **Redlock** (algoritmo de Antirez) mitiga con N nodos independientes pero es controversial. Para este proyecto: documenta los trade-offs.

### Aproximación 4: Hold con TTL (lo que vas a implementar)
El flujo real de booking platforms:
1. Guest selecciona slot → crea un **hold** con TTL de 10 min (registro en DB con `status: held`, `holdExpiresAt`).
2. Durante esos 10 min, el slot no se ofrece a otros (la query de availability excluye holds activos).
3. Guest completa el pago → hold se convierte en `confirmed`.
4. Si el TTL expira sin confirmación, un job lo libera (épica 05).

Esto combina locking + UX (le da tiempo al guest de pagar sin bloquear UI). Bajo este patrón aún tienes una race condition al crear el hold — la cubres con distributed lock O `SELECT FOR UPDATE` sobre el listing al momento de crear el hold.

### Idempotency
El cliente puede mandar `POST /reservations` dos veces (timeout, retry, double-click). Sin idempotency, creas dos reservaciones.

Estándar de la industria: **`Idempotency-Key` header** (UUID v4). El servidor almacena `(idempotencyKey, userId) → response` durante 24h. Si llega de nuevo, devuelve el mismo response (sin re-ejecutar la lógica). Stripe API es la referencia canónica.

## Tickets

### 04.1 — State machine de Reservation explícita

**Goal:** definir estados (`pending`, `held`, `confirmed`, `checked_in`, `completed`, `cancelled`) y transiciones permitidas como una tabla. Implementar `ReservationStateMachine` que valida transiciones (cada `transitionTo(newStatus)` falla si no es legal).

```
pending → held → confirmed → checked_in → completed
                          ↘ cancelled (desde held, confirmed, checked_in con políticas distintas)
```

**Concepto clave:** transiciones inválidas tiran un `IllegalReservationTransition` error con info de estado actual y target. En domain, no en application.

**Deep-dive a Claude Code:** *"Implementa una state machine para Reservation en domain/entities. Tabla de transiciones permitidas, método transitionTo que falla si la transición es ilegal. Tests unitarios cubriendo cada transición legal e ilegal. Justifica por qué esto vive en domain y no en application."*

### 04.2 — Domain entity Reservation + use cases base

**Goal:** entity `Reservation` con métodos: `hold(durationMs)`, `confirm()`, `cancel(reason)`, `checkIn()`, `complete()`. Cada uno actualiza `status` vía la state machine y registra timestamp.

Use cases en `application/use-cases/reservations/`: `RequestHold`, `ConfirmReservation`, `CancelReservation`, `CheckIn`, `Complete`.

**Deep-dive a Claude Code:** *"Diseña la entity Reservation con métodos de comportamiento y los use cases asociados. Cada use case orquesta repos + state machine + eventos (stub). Inyecta dependencias por interface."*

### 04.3 — Distributed lock helper en Redis

**Goal:** módulo `infrastructure/concurrency/redis-lock.ts` con `acquire(key, ttl) → token` y `release(key, token)`. Implementa con `SET NX EX` para acquire y Lua script para release (solo borra si el valor matchea — evita borrar lock ajeno).

**Concepto clave:** `SET NX EX` es atómico, set-if-not-exists-with-expiry. Sin `EX`, si el proceso muere el lock queda para siempre. Sin `NX`, no es un lock. El Lua script para release es porque `GET` + `DEL` no es atómico.

**Deep-dive a Claude Code:** *"Implementa un distributed lock helper sobre Redis con primitiva acquire/release. Usa SET NX EX para acquire, Lua script para release atómico. API ergonómica tipo `withLock(key, ttl, async () => {...})`. Documenta limitaciones (no CP, fencing tokens, cuándo usar Redlock)."*

### 04.4 — Hold con TTL + creación bajo lock

**Goal:** use case `RequestHold(userId, listingId, dateRange)`:
1. Acquire lock `lock:listing:{listingId}:{dateRange}` (TTL 10s).
2. Dentro del lock, query availability del listing en ese rango (excluye holds activos no expirados y reservations confirmed).
3. Si disponible, crea `Reservation` con `status: held`, `holdExpiresAt = now + 10min`.
4. Release lock.
5. Retorna reservation.

Si no se puede adquirir el lock, retornar `409 Conflict` con `code: SLOT_LOCKED_BY_ANOTHER`.

**Concepto clave:** dos niveles de "exclusión" — el lock es para la sección crítica (~50ms), el hold (10 min) es para la UX del guest.

**Deep-dive a Claude Code:** *"Implementa RequestHold use case con distributed lock + creación de Reservation en estado held con TTL. Lock corto (10s), hold largo (10min). Query de availability excluye holds activos no expirados. Justifica los dos TTLs distintos."*

### 04.5 — Confirmación de reserva: pago + transición + transacción

**Goal:** use case `ConfirmReservation(reservationId, paymentToken)`:
1. Begin transaction.
2. Lock row con `SELECT ... FOR UPDATE` (Reservation + Listing).
3. Validar que está `held` y no expirado.
4. Cobrar (mock de Stripe — devuelve éxito siempre por ahora).
5. Transicionar a `confirmed`.
6. Crear `Payment` record.
7. Commit.

Si algo falla → rollback automático, lock libera, hold sigue válido hasta TTL.

**Concepto clave:** la transacción atómica garantiza "todo o nada". Sin esto: cobras y la reservation no se confirma (peor que no cobrar).

**Deep-dive a Claude Code:** *"Implementa ConfirmReservation use case con transacción Postgres + SELECT FOR UPDATE. Incluye un mock de Stripe (success siempre por ahora). Manejo de errores: si el pago falla, rollback. Si el estado no es 'held', error 409. Tests cubriendo cada path."*

### 04.6 — Idempotency-Key middleware

**Goal:** middleware `idempotency()` aplicable a endpoints `POST`/`PUT`. Lee `Idempotency-Key` header. Almacena `(key, userId, requestHash) → (status, responseBody)` en Redis con TTL 24h.

Comportamiento:
- Primera vez: ejecuta, almacena, devuelve.
- Misma key + mismo body: devuelve response cacheado sin re-ejecutar.
- Misma key + DIFERENTE body: `409 Conflict` con `code: IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY` (caso clásico de bug del cliente).

**Concepto clave:** sin idempotency, retries del cliente duplican. Con idempotency, retries son seguros — lo que permite usar timeouts agresivos y mejor UX.

**Deep-dive a Claude Code:** *"Implementa middleware de idempotency en Express. Almacena response en Redis por 24h. Detecta key reuse con body diferente. Aplica solo a endpoints mutadores. Justifica por qué esto vive en infrastructure y no en use case."*

### 04.7 — Cancelación con políticas

**Goal:** use case `CancelReservation(reservationId, reason)`. Reglas:
- Desde `held` → siempre OK, sin penalización.
- Desde `confirmed` ≥ 48h antes del check-in → full refund.
- Desde `confirmed` < 48h → partial refund (50%).
- Desde `checked_in` o `completed` → no cancelable.

La política es del dominio. El cálculo del refund también.

**Deep-dive a Claude Code:** *"Implementa CancelReservation con políticas de refund. La política vive en domain (no hardcoded en use case). Tests cubren cada timing (>48h, <48h, in-progress, completed). Justifica por qué la política es del dominio y no de application."*

### 04.8 — Tests de concurrencia

**Goal:** tests que demuestran que el sistema funciona bajo concurrencia. Usar `Promise.all([requestHold(), requestHold()])` con mismo slot — uno debe ganar, otro debe fallar con `SLOT_LOCKED_BY_ANOTHER` o `SLOT_UNAVAILABLE`.

Test adicional: 100 requests concurrentes al mismo slot → exactamente 1 hold creado.

**Concepto clave:** estos tests son la prueba de que tu locking funciona. Si los corres y a veces fallan con duplicado, tienes una race condition real.

**Deep-dive a Claude Code:** *"Escribe tests de concurrencia para RequestHold. Promise.all con N requests al mismo slot. Assert: exactamente uno tiene éxito. Reproduce 100 veces el test para asegurarte que no es flaky. Documenta cómo detectar race conditions en CI (hint: stress test con probabilidad)."*

### 04.9 — Tabla `idempotency_keys` y limpieza

**Goal:** complementar el middleware con persistencia más durable (Redis es ephemeral). Tabla en Postgres `idempotency_keys` con `key`, `userId`, `requestHash`, `responseBody`, `createdAt`. Job nocturno que borra > 24h (épica 05 lo hace).

**Concepto clave:** Redis solo para idempotency es viable, pero si Redis se cae, idempotency desaparece. Doble-write a DB es más seguro (con costo).

**Deep-dive a Claude Code:** *"Añade persistencia de idempotency keys en Postgres como backing store de Redis. Estrategia write-through. Cleanup job stub (lo hará épica 05). Discute trade-off: Redis-only vs Redis+DB vs DB-only."*

## Decisiones a tomar en esta épica

- **Redlock o single-Redis lock:** **single-Redis con `SET NX EX`** para este proyecto. Documenta limitaciones (split-brain teórico) y cuándo escalarías a Redlock o a otra técnica (Hazelcast, ZooKeeper).
- **Hold TTL:** **10 minutos** estándar industria. Documenta cómo cambiarías según métricas (abandonment rate).
- **`SELECT FOR UPDATE` vs distributed lock para crear hold:** **distributed lock** porque te prepara para múltiples instancias del API en épica 10. `SELECT FOR UPDATE` quedaría limitado a una conexión.
- **Idempotency storage:** **Redis con DB backing** para resilience.

## AWS services touched

- **Cognito** (auth ya migrado en épica 02, se usa aquí)
- Nada nuevo de AWS — esta épica es lógica de aplicación.

## Definition of Done

- [ ] State machine de Reservation implementada con transiciones validadas
- [ ] Distributed lock helper funciona y tiene tests
- [ ] RequestHold crea hold con TTL bajo lock
- [ ] ConfirmReservation cobra (mock) y transiciona en transacción atómica
- [ ] CancelReservation aplica políticas de refund según timing
- [ ] Idempotency middleware aplicado a `POST /reservations` y `POST /reservations/:id/confirm`
- [ ] Test de concurrencia (100 requests, exactamente 1 éxito) pasa 10 veces seguidas
- [ ] Tabla `idempotency_keys` con doble-write
- [ ] README de la épica documenta cada aproximación de concurrencia con su trade-off

## Interview signal post-épica

Esta es **la** épica de "puedes defenderlo en whiteboard". Te van a preguntar:

- *"¿Cómo evitas que dos guests reserven el mismo slot?"* → response completa con trade-offs.
- *"¿Qué es Idempotency-Key y por qué importa?"* → response con ejemplo de Stripe y caso de reuse-with-different-body.
- *"Optimistic vs pessimistic locking, ¿cuándo cada uno?"* → respuesta con ejemplos.
- *"¿Por qué Redis lock con TTL y no sin?"* → respuesta sobre process crash.
- *"¿Qué pasa si el master de Redis cae justo después del SET NX EX?"* → split-brain, Redlock como mitigación.

## Trampas comunes

- Lock sin TTL → process crashea, lock eterno, sistema bloqueado.
- Release de lock sin chequear valor → borras el lock de otro proceso.
- Idempotency key dura solo en Redis sin TTL claro → memory leak.
- State machine sin estados terminales → reservation puede "regresar" a estados anteriores.
- Mock de Stripe que devuelve siempre éxito → tests engañosamente verdes; mete un mock con probabilidad de fallo configurable.
- Test de concurrencia con `Promise.all` que SIEMPRE pasa porque las requests no son realmente paralelas en el mock — verifica que tu test realmente solapa con `setTimeout` o trazas.
- `SELECT FOR UPDATE` sin transacción → no bloquea nada.
- Confiar 100% en Redis lock sin retry/timeout en el caller → un fallo de red y el endpoint cuelga.
