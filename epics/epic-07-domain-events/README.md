# Epic 07 — Domain Events + Outbox Pattern + EventBridge

**Estimación:** 4 sesiones (~10 hrs).

## Lectura paralela (guía de aprendizaje)

Lee la sección **`Épica 07 · Domain events + Outbox Pattern`** del documento [`aprendizaje-senior.html`](../../aprendizaje-senior.html) (raíz del proyecto). Cubre: el problema del dual write revisitado, el outbox pattern como respuesta canónica ("¿cómo garantizas que si confirmas la reserva el email se envía?"), por qué SKIP LOCKED resuelve concurrencia entre publishers, AggregateRoot + domain events, idempotencia obligatoria del consumer bajo at-least-once, event versioning.

**Cuándo leerlo:**
- **Antes** de empezar: el problema del dual write + outbox como solución
- **Durante** los tickets: SKIP LOCKED al implementar el publisher
- **Después** de terminar: las preguntas de entrevista + 2 ejercicios "rómpelo" (crash entre commit y enqueue + dos publishers sin SKIP LOCKED, con prompt copy-paste)

## Goal

Resolver el problema de **dual write** que dejamos pendiente en épica 05: cómo garantizar que cuando un cambio de estado se persiste, los eventos derivados también se publican — sin perder eventos por crashes ni publicar eventos de cambios que rollback'aron.

La técnica: **outbox pattern**. Eventos se escriben a una tabla `outbox` en la misma transacción que el cambio. Un job (o stream processor) los publica a un broker (BullMQ primero, EventBridge después) y los marca como published.

Esta épica es la transición conceptual de "monolito con jobs" a "sistema event-driven distribuido". Aparece en literatura senior (Designing Data-Intensive Applications, microservices.io) y se pregunta mucho.

## Pre-requisitos

- Epic 04 (ya tienes ConfirmReservation que dispara side effects)
- Epic 05 (ya tienes BullMQ — primer destino del outbox)

## Overview conceptual

### El problema del dual write
Imagina `ConfirmReservation`:
```typescript
await db.transaction(async (tx) => {
  await reservationRepo.save(reservation, tx);  // commit
});
await queue.enqueue('send-email', { reservationId });  // dual write
```

¿Qué pasa si crasheas entre el commit y el enqueue? La reservation está confirmada en DB pero el email nunca se envía.

¿Qué pasa si haces el enqueue dentro de la transacción? Tampoco funciona: la transacción puede rollback'ear pero el job ya está en la queue.

**Outbox pattern:**
```typescript
await db.transaction(async (tx) => {
  await reservationRepo.save(reservation, tx);
  await outboxRepo.insert({ event: 'ReservationConfirmed', payload }, tx);
});
// Outbox publisher (job separado) lee, publica, marca published.
```

Ahora todo es atómico contra la DB. Si crashea, al reiniciar el publisher encuentra el evento sin publicar y lo procesa. **At-least-once delivery garantizado** — exactly-once requiere consumers idempotentes.

### Domain events en el dominio
Antes del outbox, las entities producen "domain events" como parte de sus métodos:
```typescript
class Reservation {
  confirm(payment: Payment) {
    this.transitionTo('confirmed');
    this.recordEvent(new ReservationConfirmed(this.id, this.userId, payment.amount));
  }
}
```

Los use cases extraen `events` de la entity y los persisten al outbox dentro de la misma transacción que la entity.

### EventBridge como bus cross-service
EventBridge es el broker managed de AWS para eventos. Routing rules envían eventos a Lambda, SQS, SNS, otros HTTP endpoints. Schema registry (opcional) valida.

En el patrón final: outbox publica a EventBridge → consumers (Lambdas, otros servicios) procesan. En la épica, primero publicamos a BullMQ (igual que antes), después refactorizamos a EventBridge.

## Tickets

### 07.1 — Domain events en entities

**Goal:** clase base `AggregateRoot` con `recordEvent(event)` y `pullEvents() → events[]`. Cada entity (Listing, Reservation, User) extiende `AggregateRoot` y graba eventos en sus métodos de negocio.

Eventos como clases tipadas (`ReservationConfirmed`, `ListingPublished`, `ReservationCancelled`) con `eventName`, `aggregateId`, `occurredAt`, `payload`.

**Concepto clave:** los eventos viven en `domain/events/`. Son del dominio, no de infraestructura. Una entity genera eventos como expresión de cambio de estado.

**Deep-dive a Claude Code:** *"Refactoriza Reservation y Listing para extender AggregateRoot. Cada método de negocio graba el evento correspondiente (ReservationConfirmed, ListingPublished, etc.). Define los eventos como clases tipadas en domain/events. Use cases extraen eventos con pullEvents() después de modificar la entity."*

### 07.2 — Tabla outbox + repositorio

**Goal:** tabla `outbox_events` con `id` (UUID v7), `eventName`, `aggregateId`, `aggregateType`, `payload` (JSONB), `occurredAt`, `publishedAt` (NULL hasta publicar), `attempts`, `lastError`.

Repository `OutboxRepository.insert(events, tx)` que acepta una transacción.

**Concepto clave:** la tabla outbox vive en la misma DB que el dominio — sin esto, perderías la atomicidad. UUID v7 importa aquí porque permite ordenar eventos por inserción sin un timestamp separado.

**Deep-dive a Claude Code:** *"Crea la tabla outbox_events con migration Prisma y el repositorio asociado. Métodos: insert(events, tx) que acepta transacción, fetchUnpublished(limit), markPublished(id), markFailed(id, error). Índice en (publishedAt IS NULL, occurredAt) para query eficiente."*

### 07.3 — Refactor de use cases para usar outbox

**Goal:** modificar `ConfirmReservation`, `PublishListing`, `CancelReservation` (todos los que tenían `await queue.enqueue(...)` después del commit) para que dentro de la transacción inserten al outbox. Quitar el enqueue directo del use case.

**Concepto clave:** los use cases ya no conocen el queue. Solo persisten al outbox. La publicación es responsabilidad de otra capa (un job aparte).

**Deep-dive a Claude Code:** *"Refactoriza ConfirmReservation para usar outbox pattern: extrae eventos de la entity, inserta al outbox dentro de la misma transacción que el save. Quita el enqueue directo. Comparte el `tx` entre los repos para garantizar atomicidad."*

### 07.4 — Outbox publisher (job continuo)

**Goal:** worker BullMQ continuo (o cron cada 1s) que:
1. SELECT FOR UPDATE SKIP LOCKED de N eventos no publicados.
2. Para cada uno: publica al broker (BullMQ por ahora), marca `publishedAt` o `attempts++ + lastError` en fallo.
3. Commit.

`SKIP LOCKED` es clave si vas a tener múltiples publishers (épica 10).

**Concepto clave:** múltiples publishers no se pisan gracias a `SKIP LOCKED`. Sin esto, dos publishers procesarían los mismos eventos.

**Deep-dive a Claude Code:** *"Implementa el outbox publisher como worker continuo. SELECT FOR UPDATE SKIP LOCKED de batch de eventos no publicados, publica al broker, marca published. Maneja errores: incrementa attempts, registra lastError, alerta si attempts > 5. Justifica SKIP LOCKED y por qué importa para escalabilidad."*

### 07.5 — Consumers (re-implementación de jobs existentes)

**Goal:** los jobs de épica 05 (`send-confirmation-email`, `reminder-24h`) ahora son consumers de eventos del outbox. Subscribe a `ReservationConfirmed`, hacen su side effect.

**Concepto clave:** **idempotencia del consumer** es ahora obligatoria. Outbox garantiza at-least-once. El consumer debe poder ejecutar 2x sin duplicar (chequeo de "ya envié este email").

**Deep-dive a Claude Code:** *"Refactoriza send-confirmation-email y reminder-24h como consumers del evento ReservationConfirmed. Cada consumer chequea idempotencia con una tabla processed_events(consumerName, eventId). Si ya procesó, skip."*

### 07.6 — EventBridge integration (preview para épica 10)

**Goal:** stub del publisher que en producción enviará a EventBridge. Por ahora: clase `EventBridgePublisher implements EventPublisher` que loggea + enqueue a BullMQ (mismo comportamiento que antes pero detrás de la abstracción correcta).

Cuando llegues a épica 10, swap la impl por la real.

**Concepto clave:** abstracciones permiten swap de infra sin tocar lógica. El outbox publisher depende de `EventPublisher` (interface en domain o application), no de BullMQ o EventBridge directamente.

**Deep-dive a Claude Code:** *"Define la interface EventPublisher en application/ports. Dos implementaciones: BullMQEventPublisher (actual) y EventBridgeEventPublisher (stub que loggea, será real en épica 10). El outbox publisher depende solo de la interface. Justifica este nivel de indirección vs hardcodear."*

### 07.7 — Schema de eventos + versioning

**Goal:** cada evento tiene `version`. Empezamos en `v1`. Documentar en `domain/events/README.md` cómo evolucionar un evento (añadir campos opcionales = backwards compatible; quitar = nuevo `v2`).

Bonus: validación runtime con Zod del payload antes de publicar.

**Concepto clave:** los eventos son contratos. Cambiarlos sin coordinación rompe consumers. Versioning es la única forma de evolucionar sin big bang.

**Deep-dive a Claude Code:** *"Define versioning de eventos con campo version explícito. Schemas Zod por evento + versión. Documenta política de evolución: campos opcionales se pueden añadir, no quitar, no renombrar; cambios breaking requieren nueva versión + dual publish + deprecación."*

### 07.8 — Tests de outbox

**Goal:** tests que verifican:
- Crash entre `save` y publish → al restart, evento se publica (replay desde outbox).
- Múltiples publishers no duplican (SKIP LOCKED funcional).
- Consumer idempotente: correr 2x mismo evento no duplica side effect.
- Eventos fallidos quedan en outbox con `attempts > 0`.

**Deep-dive a Claude Code:** *"Escribe tests del outbox pattern. Simula crash con throw después del save pero antes del enqueue (que ya no existe — el evento debe seguir en outbox). Test de doble publisher con misma DB. Test de consumer idempotente."*

## Decisiones a tomar en esta épica

- **Polling outbox vs Postgres LISTEN/NOTIFY:** **polling con SKIP LOCKED**. LISTEN/NOTIFY tiene caveats (no persistente, no funciona cross-region con read replicas). Polling es más simple y robust.
- **Outbox cleanup:** **mantener históricamente con archive después de N días**. Borrar después de publish pierde audit trail.
- **EventBridge custom bus vs default:** **custom bus** para tu app. Más fácil de versionar y aislar de eventos AWS.
- **CDC (Change Data Capture) con Debezium:** **NO en este proyecto** — más complejidad, menos didáctico. Outbox cubre lo importante.

## AWS services touched

- **EventBridge** (preview — implementación real en épica 10)

## Definition of Done

- [ ] Entities heredan de AggregateRoot y graban eventos
- [ ] Tabla `outbox_events` con migración aplicada
- [ ] Use cases usan outbox en lugar de enqueue directo
- [ ] Outbox publisher worker corre y procesa eventos
- [ ] SKIP LOCKED previene doble-procesamiento entre workers
- [ ] Consumers son idempotentes (con tabla `processed_events`)
- [ ] Interface `EventPublisher` abstrae BullMQ vs EventBridge
- [ ] Schemas Zod validan payload de cada evento
- [ ] Tests demuestran replay después de crash + idempotencia de consumer

## Interview signal post-épica

- Problema del dual write con ejemplo concreto
- Outbox pattern: cómo funciona, qué garantiza
- At-least-once vs exactly-once vs at-most-once
- Por qué consumers idempotentes son obligatorios con at-least-once
- `SKIP LOCKED` para concurrency segura entre workers
- Schema evolution de eventos: backwards-compatible vs breaking

## Trampas comunes

- Outbox publisher sin `FOR UPDATE` → dos workers procesan el mismo evento.
- Consumer sin idempotencia → duplica side effects bajo at-least-once.
- Outbox sin índice en `(publishedAt IS NULL, occurredAt)` → query lenta cuando crece.
- Borrar eventos del outbox después de publish → pierdes audit trail; mejor archive.
- Eventos sin versioning → primer cambio breaking rompe todo silenciosamente.
- Publicar a EventBridge sin idempotency en el consumer (Lambda) → entregas duplicadas no manejadas.
- Olvidar que outbox publisher es punto único de falla si lo corres como 1 instancia — en prod, ≥ 2 con SKIP LOCKED.
