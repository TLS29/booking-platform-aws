# Epic 01 — Persistence (Prisma + PostgreSQL)

**Estimación:** 3-4 sesiones (~8 hrs).

## Lectura paralela (guía de aprendizaje)

Lee la sección **`Épica 01 · Persistence`** del documento [`aprendizaje-senior.html`](../../aprendizaje-senior.html) (raíz del proyecto). Cubre: repository pattern (interface en domain, impl en infrastructure), rich entities con constructor privado, por qué Testcontainers vence a mocks, UUID v7 vs v4, ejercicio "rómpelo" sobre lost updates, preguntas de entrevista, gotchas.

**Cuándo leerlo:**
- **Antes** de empezar: overview de repository pattern y mappers
- **Durante** los tickets: los gotchas relevantes
- **Después** de terminar: las preguntas de entrevista + ejercicio "rómpelo" (con prompt copy-paste para practicar conmigo en sesión separada)

## Goal

Modelar el dominio en Postgres con Prisma y exponerlo a la capa de aplicación a través de **repository pattern**. Aprender a hacer integration tests con Postgres real (no mocks) usando Testcontainers.

Este es el momento donde tu skill de Postgres + Prisma palanquea fuerte — pero el detalle senior está en cómo NO acoplas tu dominio a Prisma. Las entidades del dominio no son los modelos de Prisma; son clases que viven en `domain/`, y los repositorios en `infrastructure/` saben cómo mapear entre ambos.

## Pre-requisitos

- Epic 00 completo

## Overview conceptual

El error clásico al usar un ORM es exponer los modelos del ORM como entidades del dominio. Funciona al inicio, pero te ata: cualquier cambio de DB se filtra al dominio, no puedes testear lógica de negocio sin DB, y el dominio termina contaminado con campos de persistencia (`createdAt`, `version`, `_v`, IDs como string vs UUID, etc.).

La salida es **repository pattern + mappers**:
- `domain/` define `class Listing` con métodos de negocio (`publish()`, `unpublish()`, `updatePricing(money)`).
- `domain/ports/listing-repository.ts` define la interface `ListingRepository`.
- `infrastructure/persistence/prisma-listing-repository.ts` implementa la interface usando Prisma. Aquí viven los mappers `toDomain` y `toPersistence`.
- Use cases en `application/` reciben `ListingRepository` por DI; no saben que Prisma existe.

El precio: 2x más código en las primeras entidades. El beneficio: tests unitarios del dominio en milisegundos sin DB, refactor de DB sin tocar dominio, y la entidad puede tener invariantes (un `Listing.publish()` que valida que tiene fotos antes de publicar — imposible si la entidad es el record de Prisma).

Para integration tests, **Testcontainers** levanta un container de Postgres real para cada suite. Mock de DB es antipattern: mockeas un error que en producción no existirá y no capturas el error que sí existirá (constraints, locks, transaction isolation).

## Tickets

### ✅ 01.1 — Schema Prisma del dominio

**Goal:** modelar las entidades core en `prisma/schema.prisma`: `User` (host/guest), `Listing` (propiedad), `Availability` (slots), `Reservation` (estados: pending/held/confirmed/checked_in/completed/cancelled), `Review`, `Payment` (stub para épica 04).

Relaciones: User 1:N Listings, Listing 1:N Reservations, Reservation N:1 Listing, Reservation 1:N Reviews, etc. Usa `@@index` en columnas que vas a query.

**Concepto clave:** soft delete + audit fields (`createdAt`, `updatedAt`, `deletedAt`, `version`) en cada tabla relevante. UUIDs como PK (no autoincrement) para que los IDs sean URL-safe y no expongan cardinality.

**Deep-dive a Claude Code:** *"Diseña el schema Prisma para una plataforma de reservas tipo Airbnb. Entidades: User, Listing, Availability, Reservation, Review, Payment. Justifica cada FK, cada índice, y por qué usar UUID v7 en lugar de v4 para los IDs (hint: ordenamiento por inserción)."*

### 01.2 — Migrations + seed data

**Goal:** crear primera migration con `prisma migrate dev`, hacer commit del archivo de migration. Script de seed (`prisma/seed.ts`) que inserta 3 usuarios, 10 listings, 50 availability slots, algunas reservations en estados variados.

**Concepto clave:** migrations son código. Se commitean, se revisan, se aplican en orden. Nunca edites una migration ya aplicada — siempre haz una nueva.

**Deep-dive a Claude Code:** *"Genera la primera migration con Prisma migrate dev. Crea seed.ts en TypeScript que insert data realista para desarrollo y tests E2E. Explica la diferencia entre `prisma migrate dev`, `prisma migrate deploy`, y `prisma db push` y cuándo usar cada uno."*

### 01.3 — Repository pattern: interfaces en domain

**Goal:** crear `src/domain/ports/` con interfaces tipo `ListingRepository`, `UserRepository`, `ReservationRepository`. Cada una expone métodos del dominio (`findById`, `save`, `findAvailableInRange`), NO los métodos del ORM (`findUnique`, `update`, etc.).

**Concepto clave:** los métodos del repo se nombran por intención de negocio. `findAvailableInRange(listingId, from, to)` es del dominio. `findFirst({ where: {...} })` es de Prisma — eso lo escondes en la impl.

**Deep-dive a Claude Code:** *"Define las interfaces de repositorio para Listing, User, Reservation en src/domain/ports/. Métodos nombrados por intención de negocio, NO por la operación SQL. Incluye `transaction(callback)` para unit of work. Justifica cada método."*

### 01.4 — Repository pattern: implementaciones con Prisma

**Goal:** crear `src/infrastructure/persistence/prisma/` con las implementaciones. Cada repo tiene mappers `toDomain(record): DomainEntity` y `toPersistence(entity): Record`. La entidad de domain tiene constructor privado + factory method `Entity.reconstitute(props)` para que solo el mapper pueda construir desde DB.

**Concepto clave:** el mapper es el único punto donde se cruza el boundary domain/persistence. Si la entidad cambia, hay un solo lugar que toca.

**Deep-dive a Claude Code:** *"Implementa PrismaListingRepository en infrastructure/persistence/prisma. Incluye mappers toDomain y toPersistence. La entidad Listing en domain debe tener constructor privado y métodos de reconstitución. Muestra cómo se inyecta PrismaClient sin acoplarse a él."*

### 📌 01.4.5 — Carry-over de epic-00: implementar `/health/ready`

**Goal:** completar el endpoint `GET /health/ready` que se difirió de epic-00 (ticket 00.6). Hay un `TODO` en `src/interfaces/http/routes/health.ts` indicando dónde va.

**Por qué aquí y no al inicio de la épica:** el endpoint necesita un `PrismaClient` vivo. Recién en 01.4 instanciamos el singleton de PrismaClient en `infrastructure/persistence/` y lo cableamos vía DI. Ese mismo singleton es el que reusa este endpoint — sin duplicar instancias (cada `new PrismaClient()` abre su propio pool de conexiones).

**Comportamiento esperado:**
- Hace un check ligero contra Postgres (ej. `SELECT 1` vía `prisma.$queryRaw`) con timeout corto (~1s).
- Si responde dentro del timeout → 200 con `{ status: "ok", checks: { db: "ok" } }`.
- Si falla o timeout → 503 con `{ status: "fail", checks: { db: "fail" } }`.
- Cuando se agregue Redis (epic-05 o 06), extender el objeto `checks` con `redis`.

**Concepto clave:** el ALB usará este endpoint para decidir si la task recibe tráfico. Distingue de `/health/live` (que solo dice "proceso vivo"). Recuerda: el check debe ser barato — se ejecuta cada pocos segundos.

**Deep-dive a Claude Code:** _"Implementa /health/ready en Express que checa conectividad a Postgres con timeout corto vía Prisma. Reusa el PrismaClient singleton del DI. Devuelve 200 o 503 con detalle por servicio. Justifica por qué el timeout es importante."_

### 01.5 — Unit of work / transaction management

**Goal:** exponer un mecanismo para que un use case ejecute múltiples operaciones en una transacción. La interface `UnitOfWork` o un método `transaction(callback)` en cada repo. Prisma lo soporta vía `$transaction`.

**Concepto clave:** un use case como "confirmar reservación" debe: actualizar reservation, decrementar availability, crear payment, en una sola transacción. Si una falla, todas rollback.

**Deep-dive a Claude Code:** *"Diseña el patrón de unit of work sobre Prisma de modo que un use case pueda ejecutar múltiples operaciones (en múltiples repositories) en una sola transacción ACID. Compara con `prisma.$transaction([...])` y argumenta cuál es mejor para clean architecture."*

### 01.6 — Integration tests con Testcontainers

**Goal:** instalar `@testcontainers/postgresql`. Crear setup global de Vitest que levante un Postgres ephimero por test suite, corra migrations, lo limpia entre tests (con `TRUNCATE` rápido, no `DROP`).

Escribir 5-6 tests por repo (CRUD básico + queries específicos del dominio).

**Concepto clave:** "mock de DB es antipattern". El test integra contra la DB real porque ahí es donde viven los errores reales (constraints, FK violations, transaction isolation).

**Deep-dive a Claude Code:** *"Configura Vitest + Testcontainers para que cada test suite tenga un Postgres limpio. Migrations al inicio, TRUNCATE rápido entre tests. Escribe tests de PrismaListingRepository cubriendo CRUD, query por filtros, y manejo de FK violations. Justifica por qué esto es superior a mockear PrismaClient."*

### 01.7 — Soft delete + audit + versioning

**Goal:** añadir `deletedAt`, `version` a entidades relevantes. Versioning es para optimistic locking en épica 04 (concurrencia). Implementar query helper que filtra `deletedAt IS NULL` por defecto.

**Concepto clave:** soft delete preserva history. Versioning previene lost updates ("dos actualizaciones concurrentes, una se pierde sin error visible").

**Deep-dive a Claude Code:** *"Añade soft delete (`deletedAt`) y optimistic locking (`version`) al schema. Implementa lógica en los repos que: incrementa version en cada update, falla si la version del input no coincide, ignora deletedAt rows en queries. Justifica cuándo usar soft delete vs hard delete."*

## Decisiones a tomar en esta épica

- **UUID v4 vs UUID v7:** **recomendado v7** — incluye timestamp, mejor para clustering en B-tree, ordenable por inserción. Costo: más nuevo, menor adopción.
- **`@db.VarChar(N)` vs `String`:** explícito si hay límite real (emails, slugs). String si es texto libre.
- **Decimal vs Integer (cents) para Money:** **recomendado Integer cents** (Postgres `BigInt`) — sin floating point pain. Decimal funciona pero arrastra más conversiones.
- **`@@index` strategy:** indexar columnas usadas en `WHERE`, `ORDER BY`, `JOIN`. NO indexar columnas con baja cardinalidad (sex, status con 3 valores) salvo composite con otra.

## AWS services touched

Ninguno. Postgres es local con Docker en esta épica. RDS llega en épica 10.

## Definition of Done

- [ ] Schema Prisma cubre 6+ entidades con relaciones e índices justificados
- [ ] `prisma migrate dev` genera y aplica la migration sin errores
- [ ] Seed inserta data realista; `prisma db seed` corre limpio
- [ ] Cada repo tiene interface en `domain/ports/` e impl en `infrastructure/persistence/prisma/`
- [ ] Domain entities tienen constructor privado + factory methods
- [ ] Tests con Testcontainers corren en CI y local
- [ ] Cobertura básica de happy paths + FK violations + concurrency edge cases
- [ ] Soft delete y version implementados en al menos `Listing` y `Reservation`
- [ ] README de la épica explica decisiones de schema con un diagrama ER simple

## Interview signal post-épica

- Por qué el dominio no debe importar Prisma
- Cómo testear repos contra DB real sin sufrir performance
- Diferencia entre `prisma migrate dev` (genera migration) y `migrate deploy` (aplica en prod)
- Optimistic locking vs pessimistic locking
- Por qué UUID v7 vence a v4 en performance de inserción

## Trampas comunes

- Exponer `PrismaClient` directamente en use cases — adiós clean architecture.
- Mappers que copian campo por campo manualmente — error-prone. Usa un constructor que tome `Persistence → Domain` props.
- Olvidar que `prisma migrate dev` genera una migration que tienes que commitear — si no, se pierde.
- Tests que hacen `TRUNCATE` lento entre cada test — usa `DELETE FROM` o transacciones que rollback.
- Versioning sin testear conflicto — pasa silenciosamente y solo lo descubres en producción.
