# Epic 12 — Hardening & Polish: Webhooks, API Versioning, Load Test, Security

**Estimación:** 4 sesiones (~10 hrs).

## Lectura paralela (guía de aprendizaje)

Lee la sección **`Épica 12 · Hardening`** del documento [`aprendizaje-senior.html`](../../aprendizaje-senior.html) (raíz del proyecto). Cubre: el patrón Stripe para **webhooks outgoing** (HMAC + timestamp + retries + dedupe), por qué `timingSafeEqual` y no `===`, el menú de **API versioning** (URL path vs header vs query) y cuándo bumpas versión, los 4 escenarios de **load testing con k6** (smoke/load/stress/spike) y cómo interpretar bottlenecks, **OWASP top 10** aplicado al proyecto con evidencia.

**Cuándo leerlo:**
- **Antes** de empezar: webhook patterns + load testing methodology
- **Durante** los tickets: signing al implementar el delivery, scenarios al escribir k6 scripts
- **Después** de terminar: las preguntas de entrevista + ejercicio "rómpelo" (replay attack sin timestamp en HMAC, con prompt copy-paste)

## Goal

Cerrar el proyecto con los toques que distinguen un side project de un sistema production-ready:
- **Webhooks outgoing** con HMAC signing y retries (clave en interviews fintech/marketplace).
- **API versioning** strategy (cómo evolucionar la API sin romper clientes).
- **Load testing** con k6 (descubres bottlenecks reales).
- **Security review** estilo OWASP top 10.
- **Documentación final** que vende el proyecto en entrevista.

Después de esta épica, el repo está listo para enseñar.

## Pre-requisitos

- Epic 11 (sistema corriendo en cloud con CI/CD)

## Overview conceptual

### Webhooks outgoing
Tu sistema notifica a sistemas externos cuando algo pasa. Ejemplos: host quiere recibir un POST a su URL cuando un guest reserva. Quirks:
- **Firma HMAC** del payload (cliente verifica con shared secret).
- **Retries** con exponential backoff: 5 intentos, doubling delay.
- **Timeouts** cortos (5s — sino bloqueas tu queue).
- **Idempotency**: cada delivery tiene un ID; cliente debe deduplicar.
- **Replay**: dashboard de webhooks fallidos con botón de re-enviar manual.

Stripe webhooks son la referencia canónica.

### API versioning
Tres approaches:
1. **URL path**: `/v1/reservations`, `/v2/reservations`. Visible, simple, force migration.
2. **Header**: `Accept: application/vnd.booking.v2+json`. Cleaner URL, harder to test.
3. **Query param**: `?version=v2`. Cacheable issues.

Para SaaS: **URL path** suele ganar. Versiones nunca expirando es deuda; deprecation policy explícita (12 meses notice) es buena práctica.

### Load testing
**k6** es la herramienta moderna (TS-friendly, scriptable, output Prometheus/Datadog). Escenarios:
- **Smoke**: 1 user, 1 min. Sanity check.
- **Load**: ramp up a 100 RPS, sustained 10 min. Latency y errors esperados.
- **Stress**: ramp up hasta romper. Aprendes el límite.
- **Spike**: 10 RPS → 500 RPS en 1 segundo → 10 RPS. Cómo recupera.

Métricas: p99 latency, error rate, RPS sostenido, recovery time.

### Security review
OWASP Top 10 2021:
1. Broken access control — verificas en cada endpoint protegido?
2. Cryptographic failures — TLS everywhere, passwords con argon2id ya hecho ✓
3. Injection — usar query builders (Prisma) cubre SQL. XSS si renderizas HTML (esto es API, mínimo riesgo).
4. Insecure design — threat modeling de tu flow.
5. Security misconfiguration — bucket public, security groups open, etc.
6. Vulnerable components — `pnpm audit`, Dependabot.
7. ID & auth failures — covered en épica 02.
8. Software & data integrity — image signing, SLSA niveles.
9. Logging & monitoring failures — covered en épica 09.
10. SSRF — usuario envía URL, tu server fetch — limita.

## Tickets

### 12.1 — Webhook outgoing system

**Goal:** tabla `webhook_subscriptions(id, ownerId, url, secret, events[])`. Endpoint `POST /webhooks/subscriptions` para configurar.

Job `webhook-delivery` (en BullMQ o Lambda) que recibe `(subscriptionId, eventName, payload)`:
1. Construye request con header `X-Booking-Signature: t=<ts>,v1=<hmac>`.
2. POST a la URL con timeout 5s.
3. Si 2xx: marca delivered.
4. Si fail: retry exponencial hasta 5 intentos.
5. Después de 5 fallos: marca permanently_failed + notifica al owner.

Hook al outbox pattern (épica 07): subscribers de eventos son owners con webhooks.

**Concepto clave:** **HMAC signing**: `signature = HMAC-SHA256(secret, timestamp + body)`. Cliente verifica con su secret. Timestamp previene replay attacks (rechazar si > 5 min de delay).

**Deep-dive a Claude Code:** *"Diseña webhook outgoing system completo: subscriptions, delivery worker, HMAC signing (Stripe-style), retries con exponential backoff, marca de permanently_failed. Documenta cómo el cliente debe verificar la signature."*

### 12.2 — Webhook dashboard + manual replay

**Goal:** endpoints admin:
- `GET /admin/webhooks/deliveries?subscriptionId=X&status=failed` con paginación.
- `POST /admin/webhooks/deliveries/{id}/replay` que re-encola el delivery.

UI mínima opcional o solo curl.

**Concepto clave:** webhook delivery failure es 80% del tiempo problema del cliente, no tuyo. Dashboard + replay les da agency para resolver sin tu intervención.

**Deep-dive a Claude Code:** *"Implementa endpoints admin para listar deliveries (filtros por status, subscriptionId, fecha), ver detalle (request/response), replay manual. Justifica visibilidad como feature de producto."*

### 12.3 — API versioning con URL path

**Goal:** mover endpoints actuales bajo `/v1/`. Estructura de rutas Express: `router.use('/v1', v1Router)`. Documentar policy: nuevo `v2` cuando hay breaking change; `v1` deprecado con 12 meses notice; sunset date en `Deprecation` header.

**Concepto clave:** versioning no es "haz `/v2` cuando cambies algo" — es contrato. Cambio aditivo (campo nuevo opcional) NO requiere version bump. Solo breaking changes (campo removido, semantic change).

**Deep-dive a Claude Code:** *"Migra endpoints a /v1/. Establece policy de versioning: qué es breaking vs additive. Header Deprecation + Sunset cuando aplique. Documenta cómo un cliente migra v1 → v2 con dual-write period."*

### 12.4 — Load testing con k6 — smoke + load

**Goal:** script `loadtests/scenarios/smoke.js` y `loadtests/scenarios/load.js`. Smoke: 1 user 1 min. Load: 0 → 100 RPS en 2 min, sustained 5 min.

Output: latency p50/p95/p99, error rate, throughput. Comparar contra SLOs definidos (ej. p99 < 500ms, error rate < 1%).

**Concepto clave:** load test contra el sistema desplegado (cloud), no local. Local no tiene la latencia de RDS Proxy, ALB, etc.

**Deep-dive a Claude Code:** *"Crea k6 scripts para smoke y load test. Endpoints cubiertos: search listings, create hold, confirm reservation (flow completo). Métricas Prometheus output. Define SLOs y assertions en el script (test falla si p99 > 500ms)."*

### 12.5 — Load testing — stress + spike

**Goal:** scripts `stress.js` (ramp hasta romper, observa qué se rompe primero) y `spike.js` (subida brusca, observa recovery).

Documentar findings: ¿qué se quemó primero (DB connections, CPU del API, Redis CPU)? ¿Mejoras candidatas?

**Concepto clave:** stress test no es para "pasar" — es para aprender. El resultado esperado es encontrar bottlenecks. Cada bottleneck es un ticket nuevo o decisión de scale.

**Deep-dive a Claude Code:** *"Crea k6 scripts de stress y spike. Documenta cómo interpretar resultados (cuál es el bottleneck según los síntomas: latency sube linealmente vs flat vs cliff). Da 3 ejemplos de findings posibles y mitigaciones."*

### 12.6 — Security review estilo OWASP

**Goal:** checklist OWASP top 10 con findings reales del proyecto. Por cada item:
- Status: covered / partial / not applicable.
- Evidencia (link al code o test).
- Si partial: ticket de remediación.

Documentar en `SECURITY.md`.

**Concepto clave:** "se le hizo security review" es interview signal. No es perfección — es evidencia de que pensaste en cada categoría.

**Deep-dive a Claude Code:** *"Audita el proyecto contra OWASP top 10 2021. Por cada item: covered, evidencia, gaps. Genera SECURITY.md con findings. Para los gaps, abre tickets de remediación priorizados."*

### 12.7 — Dependabot + pnpm audit en CI

**Goal:** habilitar Dependabot en GitHub (PRs automáticos a `package.json` con upgrades de seguridad). Añadir `pnpm audit --audit-level=moderate` como step en CI — falla si hay vulns moderate o high.

**Concepto clave:** dependencias son ataque vector clásico (Log4Shell, event-stream, ua-parser-js). Dependabot reduce ventana de exposición de meses a días.

**Deep-dive a Claude Code:** *"Configura Dependabot con .github/dependabot.yml (npm + GitHub Actions + Dockerfile). Añade pnpm audit step a CI workflow con threshold moderate. Justifica el tiempo de actualizar deps vs el riesgo de regression."*

### 12.8 — Documentación final del proyecto

**Goal:** README de root finalizado con:
- Description 1 párrafo (qué es y por qué).
- Stack y servicios (link a `stack.md`).
- Diagrama de arquitectura (link a `architecture.md`).
- Demo (si lo dejas corriendo: URL + creds de testing).
- **Talking points para interview** (top 5 cosas a destacar).
- Cómo correr local.
- Decisiones que tomé.
- Qué haría diferente con más tiempo (autocriticism honest).

**Concepto clave:** interviews preguntan "cuéntame de un proyecto". Tu README debe ser la respuesta escrita.

**Deep-dive a Claude Code:** *"Refina el README de root para audiencia interview. Sección 'why this project' que vende, top 5 technical highlights, anti-CV (lo que NO incluí y por qué), retrospective honest."*

### 12.9 — Demo data + scripts de seed

**Goal:** seed más rico que el de épica 01: 20 listings con fotos reales (placeholder service), 50 reservations en variedad de estados. Script `pnpm seed:demo` que prepara la DB para una demo en entrevista.

**Concepto clave:** una demo en vivo en entrevista con DB vacía no impresiona. 30 segundos de scripted data hace ver el sistema "vivo".

**Deep-dive a Claude Code:** *"Implementa seed:demo enriquecido. Listings con descripciones realistas, fotos vía placeholder service o stock subido a S3, distribución realista de estados. Idempotente (puedes correrlo 2x)."*

### 12.10 — Performance optimizations identificadas en load test

**Goal:** del findings del load test, implementar 1-2 mejoras concretas:
- Si DB es bottleneck: read replicas o más cache.
- Si CPU es bottleneck: scaling más agresivo o N+1 queries.
- Si Redis es bottleneck: pipelining o batch operations.

**Concepto clave:** premature optimization es real, pero "lo testeé y este era el bottleneck" es legítimo. Documenta antes/después con números.

**Deep-dive a Claude Code:** *"De los findings del load test, identifica el bottleneck más impactante. Implementa 1-2 optimizaciones concretas (cache layer extra, query refactor, índice nuevo). Mide antes/después con misma carga. Comparte la metodología."*

## Decisiones a tomar en esta épica

- **Webhook delivery: BullMQ vs SQS:** **BullMQ** mantiene consistencia con épica 05/07. SQS si quieres separación total.
- **API version 1 → 2 dual-write:** si encuentras un breaking change, dual-write period **mínimo 30 días** para clientes.
- **k6 vs Artillery vs Locust:** **k6** — TS-friendly, gold standard moderno.
- **Security review profundidad:** **OWASP top 10** + pnpm audit es suficiente. Pen test full sería overkill.

## AWS services touched

Mínimo nuevo. Refinamientos sobre lo deployado en épica 10.

## Definition of Done

- [ ] Webhook system: subscriptions, delivery, signing, retries, replay
- [ ] Endpoints bajo `/v1/`; versioning policy documentada
- [ ] k6 smoke + load + stress + spike scripts ejecutables
- [ ] Load test ran contra prod-like environment, results documentados
- [ ] SECURITY.md con OWASP top 10 review
- [ ] Dependabot y pnpm audit activos
- [ ] README final que vende el proyecto
- [ ] Seed:demo prepara la DB en 1 comando
- [ ] 1-2 optimizaciones de performance hechas y medidas

## Interview signal post-épica

- Webhook design (signing, retries, idempotency, replay)
- API versioning policy y patterns
- Load testing methodology y cómo interpretar resultados
- Security review approach (OWASP)
- Performance optimization driven by data (no guessing)

## Trampas comunes

- Webhook delivery sin timeout → bloquea queue cuando cliente no responde.
- Signature verification que NO incluye timestamp → vulnerable a replay attacks.
- API versioning sin sunset policy → mantienes 8 versiones forever.
- Load test contra localhost → no representa nada real.
- Security review "checklist completo" sin evidencia → teatro.
- Optimización sin medición previa → fixing the wrong thing.
- Dependabot abrumador (PRs cada hora) → configura grouping y schedule.
