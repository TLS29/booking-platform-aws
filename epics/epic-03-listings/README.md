# Epic 03 — Listings: CRUD + Search + Cache

**Estimación:** 3 sesiones (~8 hrs).

## Lectura paralela (guía de aprendizaje)

Lee la sección **`Épica 03 · Listings + Search + Cache`** del documento [`aprendizaje-senior.html`](../../aprendizaje-senior.html) (raíz del proyecto). Cubre: rich domain model vs anemic (con justificación práctica), cursor vs offset pagination (por qué offset rompe con escrituras concurrentes), cache patterns (cache-aside, write-through, tag-based), por qué cachear IDs y filtrar fino en app, OpenAPI como single source of truth con Zod.

**Cuándo leerlo:**
- **Antes** de empezar: rich domain model y cursor pagination
- **Durante** los tickets: cache patterns al implementar SearchListings
- **Después** de terminar: las preguntas de entrevista + 2 ejercicios "rómpelo" (offset bug + cache explosion, con prompt copy-paste)

## Goal

Implementar el primer flow de negocio completo (un host crea un listing y un guest lo busca). Aprovechar para meter **OpenAPI auto-generado desde Zod**, paginación cursor-based, y el primer uso de Redis como **cache de búsquedas**.

Aquí se hace evidente la separación domain/application/infrastructure: los use cases son thin, los controllers son thinner, las entities tienen comportamiento. Si terminas con use cases de 200 líneas, algo está mal.

## Pre-requisitos

- Epic 01 (persistence)
- Epic 02 (auth, para que los endpoints requieran user logueado)

## Overview conceptual

Un listing tiene un lifecycle:
1. Host crea borrador (`status: draft`) — no aparece en búsqueda.
2. Host completa info, sube fotos (épica 08), publica (`status: published`).
3. Guests buscan, ven detalles, eventualmente reservan (épica 04).
4. Host puede pausar/despublicar.

La búsqueda es el centro. Filters típicos: location (ciudad, lat/lng + radio), date range (`availableFrom..availableTo`), capacity, price range, amenities. Paginación con **cursor** (no offset) porque offset rompe con tablas grandes y al ordenar con cambios concurrentes.

Cache de búsqueda es delicado: si cacheas resultados por exact filter combination, hit rate es bajísimo (cada user pone filtros distintos). Estrategia: cache la lista de IDs por (location, date range) — los filtros menos comunes (capacity, price) se aplican post-cache. Trade-off: más complicado, pero hit rate sube de ~5% a ~40% en una plataforma real.

OpenAPI auto-generado: una sola fuente de verdad. Defines un schema Zod, derivas el tipo TS, lo usas para validar el request, y la spec OpenAPI se genera del mismo schema. Cero drift entre código y docs.

## Tickets

### 03.1 — Domain entity Listing con comportamiento

**Goal:** clase `Listing` en `domain/entities/` con métodos: `publish()`, `unpublish()`, `updatePricing(money)`, `addAmenity(name)`, `removeAmenity(name)`. Validaciones de invariantes en cada método (ej. `publish()` falla si no hay al menos 1 foto y precio > 0).

**Concepto clave:** "anemic domain model" antipattern — entidad que es solo bag of properties con getters/setters. Una entidad senior tiene comportamiento y protege sus invariantes.

**Deep-dive a Claude Code:** *"Diseña la entity Listing en domain/entities/ con métodos de comportamiento (publish, unpublish, updatePricing, etc.). Cada método valida invariantes y lanza DomainError específico si se viola. Compara con la versión 'anemic' y justifica por qué este enfoque escala mejor."*

### 03.2 — Use cases: CRUD de listings

**Goal:** use cases en `application/use-cases/listings/`:
- `CreateListing` (host crea borrador)
- `UpdateListing` (host edita; chequeo de ownership)
- `PublishListing` / `UnpublishListing`
- `DeleteListing` (soft delete)
- `GetListingById`

Cada uno recibe DTOs Zod-validated, retorna response DTOs, y NO conoce Express ni Prisma.

**Concepto clave:** un use case es un command/query handler. Si tu use case toca `req` o `res`, está mezclado con la capa de delivery. Mantén thin.

**Deep-dive a Claude Code:** *"Implementa los use cases de CRUD de listings en application/use-cases/listings/. Cada uno recibe un input DTO (schema Zod), depende de repositories vía interfaces, y retorna un output DTO. Incluye ownership checks. NO importa nada de Express ni Prisma."*

### 03.3 — Controllers + routes con Express

**Goal:** controllers en `interfaces/http/controllers/listing-controller.ts`. Cada handler: parsea request con schema, llama al use case, devuelve response. Sin lógica de negocio.

Routes en `interfaces/http/routes/listings.ts` con `requireAuth`, `requireRole('host')` donde aplique.

**Concepto clave:** controllers son "thinner than thin". Su responsabilidad: traducir HTTP a use case input, traducir use case output a HTTP. Punto.

**Deep-dive a Claude Code:** *"Crea controllers y routes Express para CRUD de listings. Validación de input con Zod schemas (request body + path params). Manejo de errores delegado al error handler central. Aplicación de middleware de auth y rol según corresponda."*

### 03.4 — Búsqueda con filtros + paginación cursor

**Goal:** endpoint `GET /listings` con query params: `location`, `from`, `to`, `minPrice`, `maxPrice`, `capacity`, `amenities[]`, `cursor`, `limit`. Implementación: query Prisma con `where` dinámico + `take` + `cursor`-based pagination.

**Concepto clave:** cursor-based vs offset:
- Offset: `LIMIT 20 OFFSET 100` → DB itera 120 rows.
- Cursor: `WHERE id > 'lastId' LIMIT 20` → 20 rows. Estable bajo inserciones.

**Deep-dive a Claude Code:** *"Implementa búsqueda de listings con filtros opcionales y paginación cursor-based. Schema Zod del query params. Query Prisma con composición de WHERE dinámica. Cursor en base64 que codifica el último ID + timestamp. Compara cursor vs offset con un ejemplo concreto donde offset falla."*

### 03.5 — Cache de búsqueda en Redis

**Goal:** módulo `infrastructure/cache/redis-cache.ts` con `get`, `set`, `del`, `setWithTtl`. Wrapper `cached(key, ttl, fetch)` que aplica cache-aside pattern. Aplicarlo a `SearchListings`.

Estrategia: cache solo `(location, dateRange)` → lista de listing IDs. Re-query DB por los detalles (Prisma con `WHERE id IN (...)` es rápido). Invalidación: cuando un listing cambia, invalidar todas las keys que lo incluyan (set inverse mapping).

**Concepto clave:** cache invalidation es "una de las dos cosas difíciles en CS". Patterns: TTL corto (eventually consistent), write-through (caro), tag-based invalidation (este).

**Deep-dive a Claude Code:** *"Implementa cache-aside pattern en Redis para búsquedas de listings. Cachea por (location, dateRange) → array de listing IDs. TTL de 60s para mitigar staleness. Invalidación tag-based al actualizar un listing. Justifica trade-offs y muestra cómo medirías el hit rate."*

### 03.6 — OpenAPI auto-generado desde schemas Zod

**Goal:** instalar `@asteasolutions/zod-to-openapi`. Anotar los schemas Zod con `.openapi()` (description, example). Generar `openapi.json` al boot y exponer Swagger UI en `/docs`.

**Concepto clave:** schemas Zod son el "single source of truth". TS types derivan de ellos. Validación runtime usa los mismos. OpenAPI también. Cero drift.

**Deep-dive a Claude Code:** *"Configura zod-to-openapi para generar la spec OpenAPI 3.1 desde los schemas Zod de listings. Expón Swagger UI en /docs. Incluye descripciones, examples, y responses estándar (200/400/401/403/404/409). Demuestra que el código y la spec NO pueden diverger."*

### 03.7 — Tests integration de listings

**Goal:** suite de tests con Testcontainers que cubre:
- Host crea, edita, publica, despublica, borra
- Guest busca con varios filtros y obtiene resultados consistentes
- Cursor pagination devuelve resultados estables incluso al insertar concurrente
- Cache hit y miss comportamientos esperados
- Ownership check: otro host no puede editar el listing

**Deep-dive a Claude Code:** *"Escribe tests de integración para el flow completo de listings con Testcontainers. Cubre happy paths, ownership errors, pagination edge cases, cache hit/miss. Cada test es independiente; usa truncate rápido entre tests."*

## Decisiones a tomar en esta épica

- **Search engine:** ¿Postgres FTS, OpenSearch, o just LIKE?  **Recomendado:** Postgres FTS al inicio (ya tienes Postgres). OpenSearch es overkill para el ejercicio salvo que quieras explícitamente tocarlo (lo añadirías en épica 12 como bonus).
- **Cache key strategy:** ¿filter hash completo o just (location, dateRange)? **Recomendado:** (location, dateRange) — mejor hit rate, post-filter en app. Documenta lo que descartas.
- **Geographic search:** ¿lat/lng + PostGIS o solo city string? **Recomendado:** city string en MVP, PostGIS en épica 12 si quieres.

## AWS services touched

Ninguno todavía (Redis es Upstash o Docker local; DB es Postgres local).

## Definition of Done

- [ ] Host puede crear, editar, publicar, despublicar, borrar un listing
- [ ] Guest puede buscar con filtros: location + date range + price + capacity
- [ ] Paginación cursor-based funcionando y testeada
- [ ] Cache de búsqueda con hit rate medido (log o métrica)
- [ ] Invalidación de cache al actualizar listing funciona
- [ ] OpenAPI spec accesible en `/docs`, refleja el código actualizado
- [ ] Tests cubren happy + 4-5 error cases
- [ ] Domain entity `Listing` tiene métodos de comportamiento, no solo getters/setters
- [ ] Controllers son thin (sin lógica de negocio)

## Interview signal post-épica

- Diferencia entre rich domain model y anemic domain model
- Por qué cursor-based pagination > offset
- Cache invalidation strategies y trade-offs
- Cómo evitar drift entre código y API docs
- Cuándo Postgres FTS basta y cuándo no

## Trampas comunes

- Lógica de negocio en el controller — todo el sentido de clean arch perdido.
- Cachear el response completo del search → invalidation imposible al cambiar 1 listing.
- Offset pagination con `ORDER BY updatedAt DESC` → al insertar nuevos rows, paginación se rompe.
- Schema Zod del request en el controller y otro schema diferente en el use case — single source of truth perdido.
- Cursor en plain text (incluye el ID legible) — leak de info. Codifica en base64 + signed.
