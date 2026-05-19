# Epic 06 — Rate Limiting + Distributed Concurrency Patterns

**Estimación:** 3 sesiones (~7 hrs).

## Lectura paralela (guía de aprendizaje)

Lee la sección **`Épica 06 · Rate limit + Redlock + Circuit breaker`** del documento [`aprendizaje-senior.html`](../../aprendizaje-senior.html) (raíz del proyecto). Cubre: los 4 algoritmos de rate limiting con trade-offs (fixed/sliding window/token bucket), por qué Lua atómico es necesario en Redis, **Redlock y la controversia Kleppmann vs Antirez** (mutex de eficiencia vs correctness), circuit breaker (estados y por qué antes que retries), stale-while-revalidate (cuándo es safe y cuándo es bug).

**Cuándo leerlo:**
- **Antes** de empezar: los 4 algoritmos + la sección de Redlock
- **Durante** los tickets: circuit breaker al wrapear clientes externos
- **Después** de terminar: las preguntas de entrevista + 2 ejercicios "rómpelo" (atomicidad del rate limiter + circuit breaker rescuing servicio caído, con prompt copy-paste)

## Goal

Profundizar en patterns de control de concurrencia distribuida más allá del lock simple de épica 04: **sliding window rate limiter**, **Redlock** (algoritmo, con sus controversias), **circuit breaker** para servicios externos, **cache con stale-while-revalidate**.

Estos son patrones que aparecen en interview senior y que diferencian "sé usar Redis" de "sé diseñar sistemas distribuidos".

## Pre-requisitos

- Epic 04 (ya tienes el lock helper básico)
- Epic 05 (necesitas el contexto de jobs y workers)

## Overview conceptual

### Rate limiting
Tres algoritmos clásicos:
1. **Fixed window:** "máximo N requests por minuto, reseteado en cada minuto exacto". Simple, pero permite bursts en el límite (199 al final del minuto, 199 al inicio del siguiente = 398 efectivos en 2 segundos).
2. **Sliding window log:** guarda timestamp de cada request y cuenta los del último N segundos. Preciso pero costoso en memoria.
3. **Sliding window counter:** combina dos fixed windows con interpolación. Buen balance — el que vamos a implementar.

Diferenciar quién paga el rate limit: por user (autenticado), por IP (no autenticado), por API key. Headers estándar: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`.

### Distributed lock revisitado: Redlock
Single-Redis lock (épica 04) tiene una vulnerabilidad teórica: si el master cae justo después del SET y antes de replicar, dos clientes pueden tener el lock. **Redlock** propone N nodos Redis independientes (no replicados): tomas mayoría (N/2 + 1).

Es controvertido. Martin Kleppmann publicó una crítica famosa ("How to do distributed locking"); Antirez respondió. Para interview, vale tener opinión informada: Redlock es OK para mutex ergonómico pero NO para correctness garantizada — para eso necesitas fencing tokens (ZooKeeper, etcd).

### Circuit breaker
Patrón para no martillar un servicio externo que está caído. Estados: `closed` (todo bien), `open` (todos los requests fallan inmediatamente), `half-open` (después de cooldown, deja pasar 1 para probar). Si éxito → `closed`. Si fallo → `open` otra vez.

Usado para: llamadas a SES, Stripe, APIs de terceros, incluso DB en algunos casos. Librerías: `opossum` para Node.

### Cache stale-while-revalidate
Patrón HTTP/cache: cuando una entry está stale pero no expired, se sirve cacheada Y se refresca async. Trade-off latencia vs freshness. Funciona genial para data que cambia poco pero queremos casi-fresca.

## Tickets

### 06.1 — Sliding window rate limiter en Redis

**Goal:** módulo `infrastructure/rate-limit/sliding-window.ts`. API: `consume(key, limit, windowMs) → { allowed, remaining, resetAt }`.

Implementación con `ZADD` (timestamp como score) + `ZREMRANGEBYSCORE` (limpia los viejos) + `ZCARD` (cuenta los del window). En script Lua para atomicidad.

**Concepto clave:** Lua script atómico es esencial — sin él, race entre add y count puede dejar pasar requests de más.

**Deep-dive a Claude Code:** *"Implementa sliding window rate limiter en Redis con script Lua atómico (ZADD + ZREMRANGEBYSCORE + ZCARD). API: consume(key, limit, windowMs). Documenta por qué Lua atómico es necesario y compara con sliding window counter (más memory-eficiente)."*

### 06.2 — Middleware de rate limit por user / IP / endpoint

**Goal:** middleware Express `rateLimit({ keyFn, limit, windowMs, code })`. Aplicar:
- Por user autenticado: 100 req/min en endpoints normales.
- Por IP no autenticado (signup, login): 20 req/min — más estricto.
- Por endpoint pesado (search): 30 req/min separado.

Headers `X-RateLimit-*` en cada response. `429 Too Many Requests` con `Retry-After` cuando se excede.

**Concepto clave:** la `keyFn` separa los buckets. `user:{id}:search` ≠ `user:{id}:reservations` — un endpoint pesado no agota la cuota total.

**Deep-dive a Claude Code:** *"Crea middleware de rate limiting con keyFn flexible. Aplica 3 políticas distintas: por user, por IP, por endpoint pesado. Headers X-RateLimit-*. 429 con Retry-After. Justifica por qué buckets separados por endpoint."*

### 06.3 — Redlock implementation (o adopción de la librería)

**Goal:** instalar `redlock` npm package O implementar a mano sobre 3 nodos Redis (puedes simular con `redis://localhost:6379/0`, `/1`, `/2` — distintas DBs, no es realista pero ilustra). Refactorizar el `withLock` helper de épica 04 para usar Redlock opcionalmente.

**Concepto clave:** Redlock es un trade-off, no un fix mágico. Para interview: explica el algoritmo (mayoría de N), las críticas (clock skew, GC pauses), las alternativas (fencing tokens, Postgres advisory locks).

**Deep-dive a Claude Code:** *"Integra Redlock en el helper withLock. Documenta el algoritmo: tomar lock en mayoría de N nodos, validar tiempo total < TTL. Discute las críticas de Kleppmann y la respuesta de Antirez. Alternativas: Postgres advisory locks, fencing tokens con ZooKeeper. Cuándo usar cada uno."*

### 06.4 — Circuit breaker para llamadas externas

**Goal:** instalar `opossum`. Wrap del cliente de Stripe (mock) y del cliente de SES (mock) con circuit breaker. Configurar `errorThresholdPercentage: 50, resetTimeout: 30000`.

Test: llama 10 veces, las 6 primeras fallan → circuit opens → siguientes fallan rápido sin tocar el servicio → después de 30s reset → half-open → si éxito, closes.

**Concepto clave:** circuit breaker protege a tu sistema de cascading failures. Si Stripe está caído, sin breaker tus workers se cuelgan en timeouts. Con breaker, fallan rápido y libran capacidad.

**Deep-dive a Claude Code:** *"Implementa circuit breaker con opossum sobre clientes externos (Stripe mock, SES mock). Estados closed/open/half-open. Métricas custom (state, error rate, fallback count). Test reproduciendo apertura del circuit y reset. Justifica por qué esto va antes que retries (no después)."*

### 06.5 — Cache stale-while-revalidate

**Goal:** extender el cache helper de épica 03 para soportar SWR. API: `swr(key, ttl, staleTtl, fetch) → value`. Si fresh, devuelve. Si stale, devuelve viejo + refresca async. Si missing, fetch y guarda.

Aplicar a `SearchListings` (resultados son eventually consistent).

**Concepto clave:** SWR mejora p99 latency con costo de mostrar data ligeramente vieja. Para search results, aceptable. Para precios o availability, NO.

**Deep-dive a Claude Code:** *"Implementa stale-while-revalidate sobre Redis. API: swr(key, ttl, staleTtl, fetch). Si fresh, return. Si stale, return + revalidate async. Aplica a SearchListings. Discute cuándo SWR es seguro y cuándo es bug (hint: data crítica como pricing)."*

### 06.6 — Coordinated burst handling con token bucket (opcional avanzado)

**Goal:** alternativa al sliding window: token bucket. Permite bursts cortos pero promedio sostenido. Útil si quieres "100 req/min pero permite 20 en 1s ocasionalmente".

**Concepto clave:** sliding window vs token bucket — diferentes shape de tráfico permitido. Sliding window es más estricto, token bucket más permisivo en bursts.

**Deep-dive a Claude Code:** *"Implementa token bucket rate limiter en Redis. Compara matemáticamente con sliding window: dado mismo límite por minuto, en qué patrón de tráfico cada uno permite más/menos. Cuándo elegir cada uno."*

## Decisiones a tomar en esta épica

- **Sliding window vs token bucket:** **sliding window counter** por defecto — comportamiento más predecible. Token bucket si specifically necesitas tolerancia a bursts.
- **Redlock real o single-Redis con disclaimer:** **single-Redis con disclaimer**. Redlock real necesita ≥3 nodos independientes — overkill para este proyecto. Documentas qué cambiaría en producción.
- **Circuit breaker per-client o per-operation:** **per-client** (Stripe, SES) por simplicidad. Per-operation si tienes operaciones con SLOs muy distintos.
- **SWR para qué:** **search, listing details** (cambian poco). NO para availability ni reservations.

## AWS services touched

Ninguno todavía. Sigues local con Docker/Upstash.

## Definition of Done

- [ ] Sliding window rate limiter funciona; test demuestra que NO permite > N en window
- [ ] Tres políticas de rate limit aplicadas (user, IP, endpoint pesado)
- [ ] Headers `X-RateLimit-*` en respuestas
- [ ] Redlock o equivalente integrado, documentado con sus trade-offs
- [ ] Circuit breaker abre y cierra correctamente bajo fallos
- [ ] SWR aplicado a SearchListings, métrica de hit rate post-SWR vs antes
- [ ] Tests cubren cada componente bajo carga simulada
- [ ] README documenta opinión sobre Redlock (informada, no copy-paste)

## Interview signal post-épica

- Diferencia entre fixed/sliding/token bucket rate limiters
- Headers estándar de rate limit
- Algoritmo de Redlock + críticas + alternativas
- Por qué circuit breaker antes que retries
- SWR pattern y cuándo es seguro

## Trampas comunes

- Rate limit sin Lua → race condition deja pasar más requests.
- Una sola key global de rate limit → un usuario abusivo bloquea a todos.
- Circuit breaker con threshold demasiado alto (ej. 90%) → solo abre cuando ya fue tarde.
- Circuit breaker sin fallback → cuando abre, request falla con feo error en lugar de degradación graceful.
- SWR sin cap de concurrencia en revalidación → 1000 requests stale al mismo tiempo lanzan 1000 fetches (thundering herd).
- Redlock con clock drift → en clusters con NTP roto, garantía rota silenciosamente.
