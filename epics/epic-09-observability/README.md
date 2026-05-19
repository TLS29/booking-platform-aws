# Epic 09 — Observability: Datadog APM + CloudWatch + Métricas + Alertas

**Estimación:** 4 sesiones (~10 hrs). Subestimas el tiempo que toma observability. **Activa el trial de Datadog al INICIO de esta épica, no antes.**

## Lectura paralela (guía de aprendizaje)

Lee la sección **`Épica 09 · Observability`** del documento [`aprendizaje-senior.html`](../../aprendizaje-senior.html) (raíz del proyecto). Cubre: los tres pilares (logs/metrics/traces) y por qué los tres, RED method y por qué p99 (no promedio), counter/gauge/histogram (y mal uso de cada uno), sampling (head-based vs tail-based, por qué 100% errors), SLO vs SLA vs SLI + error budget, alertas accionables vs alert fatigue, correlation ID propagation cross-service.

**Cuándo leerlo:**
- **Antes** de empezar: los tres pilares + por qué p99
- **Durante** los tickets: tipos de métricas al implementar custom metrics, alertas accionables al configurar monitors
- **Después** de terminar: las preguntas de entrevista + ejercicio "rómpelo" (alert sin recovery threshold = flapping, con prompt copy-paste)

## Goal

Hacer el sistema **observable**: tres pilares de observability (logs, metrics, traces) bien implementados, dashboards que cuentan la historia operacional, alertas que disparan cuando algo está mal.

Este es el skill que distingue al senior que ha estado de guardia del que solo ha escrito features. En interview: *"cuéntame de un incidente que resolviste"* o *"cómo sabes si tu sistema está sano"* — esas preguntas se contestan con esto.

## Pre-requisitos

- Epic 07 (eventos te dan métricas custom interesantes)
- Cuenta de Datadog (trial 14 días — activar AHORA, no antes)
- **Importante:** vas a quemar el trial de Datadog durante esta épica. Trabaja con foco para no desperdiciarlo.

## Overview conceptual

### Los tres pilares
1. **Logs**: eventos discretos con contexto. "Hubo un error procesando la reservation 123 con error X".
2. **Metrics**: agregados numéricos a lo largo del tiempo. "Latency p99 del endpoint /reservations en los últimos 5 min: 800ms".
3. **Traces**: secuencia de spans que conectan operaciones. "Request /reservations → query DB (200ms) → publicar evento (50ms) → response (250ms total)".

Los tres se complementan. Logs te dan detalle, metrics te dan tendencias, traces te dan causalidad.

### Datadog en este proyecto
- **APM (traces)**: `dd-trace` library instrumenta Express, Prisma, Redis automáticamente. Spans aparecen en Datadog UI.
- **Logs**: pino-datadog transport. Logs ya estructurados (épica 00) se mandan tal cual.
- **Custom metrics**: `dogstatsd` para métricas custom como "reservations_confirmed_total", "hold_duration_seconds".
- **Dashboards**: dashboards JSON-as-code, commiteados.
- **Monitors (alertas)**: dispara cuando una métrica cruza umbral.

### Después del trial: CloudWatch como fallback permanente
- Logs van también a CloudWatch (doble destino, costo despreciable).
- Métricas custom via CloudWatch Metrics API.
- Logs Insights queries replican lo que hacías en Datadog.
- Alarmas CloudWatch + SNS replican monitors.

### Correlation ID + distributed tracing
Tu correlation ID (épica 00) debe propagarse a:
- Logs (ya lo hace)
- Traces (Datadog usa su propio `trace.id`, pero puedes inyectar correlation_id como tag)
- Mensajes de queue (header del job)
- Llamadas HTTP a otros servicios (header)

Sin esto, debugging un incident requiere correlación manual entre logs/traces/jobs — agotador.

## Tickets

### 09.1 — Logs estructurados con Pino → Datadog + CloudWatch

**Goal:** configurar Pino con dos transports paralelos: `pino-datadog-transport` y CloudWatch Logs (via Datadog log forwarder o `winston-cloudwatch` como fallback).

Cada log incluye: `level`, `time`, `correlationId`, `userId` (cuando hay auth), `service`, `env`, `traceId`, `spanId`, `message`, contexto adicional.

**Concepto clave:** logs estructurados (JSON) vs unstructured (plain text). Estructurados son query-ables; unstructured requieren regex.

**Deep-dive a Claude Code:** *"Configura Pino con doble transport: Datadog HTTP intake y CloudWatch Logs. Cada log incluye correlationId, traceId, userId, env. Sample los logs DEBUG en producción (cost). Justifica cuándo NO loggear (PII en payloads)."*

### 09.2 — APM con dd-trace

**Goal:** instalar `dd-trace`, inicializar al inicio del proceso (antes de cualquier require). Auto-instrumentation captura Express, Prisma, Redis, BullMQ, HTTP outbound, AWS SDK.

Configurar `service`, `env`, `version` (de git SHA). Sampling rate 100% en dev, 10% en prod (cost).

**Concepto clave:** dd-trace **debe** inicializarse antes que cualquier require de las libs que instrumenta — si no, monkey-patching falla.

**Deep-dive a Claude Code:** *"Inicializa dd-trace al boot del proceso. Auto-instrumentation de Express, Prisma, Redis, BullMQ. Tags: service, env, version. Sampling rate configurable. Documenta cómo verificar que la instrumentación está activa con una request de prueba."*

### 09.3 — Custom spans + tags en use cases críticos

**Goal:** wrappear los use cases sensibles (`RequestHold`, `ConfirmReservation`) con custom spans nombrados (`reservation.request-hold`). Añadir tags: `listing_id`, `user_id`, `outcome` (success / lock_failed / unavailable).

Esto te permite filtrar traces en Datadog: "muéstrame todas las request-hold que fallaron por SLOT_LOCKED".

**Concepto clave:** auto-instrumentation captura HTTP/DB, pero la semántica del negocio (qué tipo de fallo, qué entidad) la añades tú con tags custom.

**Deep-dive a Claude Code:** *"Añade custom spans con tags semánticos a los use cases críticos. Nombres consistentes (verbo.recurso). Tags: outcome, durations en milisegundos, IDs principales. Muestra una query Datadog que filtra por outcome=lock_failed en las últimas 24h."*

### 09.4 — Custom metrics con dogstatsd

**Goal:** instalar `node-dogstatsd`. Crear módulo `infrastructure/metrics/dogstatsd.ts`. Emit métricas:
- `reservations.confirmed.total` (counter)
- `reservations.hold_duration_seconds` (histogram)
- `reservations.confirm.latency_ms` (histogram)
- `outbox.events_pending` (gauge — emite cada N segundos)
- `cache.hit_rate` (gauge)

**Concepto clave:** counter / gauge / histogram. Counter solo sube. Gauge es valor actual. Histogram permite percentiles (p50, p99). Elegir mal te limita.

**Deep-dive a Claude Code:** *"Implementa wrapper de dogstatsd con métricas counter/gauge/histogram tipadas. Emit métricas desde use cases y outbox publisher. Documenta cuándo cada tipo de métrica aplica. Da 3 ejemplos donde elegir gauge en lugar de counter o viceversa cambia la utilidad."*

### 09.5 — Dashboards en Datadog (as code)

**Goal:** crear 3 dashboards JSON:
1. **Service Overview**: requests/min, error rate, latency p50/p99, top endpoints por latency.
2. **Reservations**: confirmed/min, hold success rate, average hold duration, cancellations by reason.
3. **Operational**: outbox events pending, job queue depth, DLQ count, cache hit rate.

Guardar como `infra/dashboards/*.json`. Exportar desde UI, commitear, recrear con API si se borra.

**Concepto clave:** dashboards como código = recreables, revisables en PRs, no se pierden cuando alguien borra el workspace.

**Deep-dive a Claude Code:** *"Diseña 3 dashboards Datadog: service overview, reservations business, operational. Exporta como JSON y commitea en infra/dashboards/. Script que los recrea via Datadog API. Justifica las métricas elegidas (qué señal te dan)."*

### 09.6 — Monitors (alertas) en Datadog

**Goal:** crear monitors:
- Error rate > 5% en 5 min → P1 alert (notify oncall)
- Latency p99 > 2s en 10 min → P2 alert
- Outbox events_pending > 1000 → P2 alert (publisher atascado)
- Job DLQ count > 0 → P2 alert (algo falla persistente)
- DB connections > 80% pool → P3 alert (preventivo)

Cada monitor tiene runbook link (markdown en repo).

**Concepto clave:** alert fatigue es el enemigo. Solo alerta lo que requiere acción humana. "Latency subió 10%" en horario normal no es alerta, es métrica.

**Deep-dive a Claude Code:** *"Configura 5 monitors en Datadog con niveles de severidad (P1/P2/P3). Cada uno con threshold justificado, evaluation window, recovery threshold (mayor que trigger para evitar flapping), y runbook link. Justifica por qué CADA alerta requiere acción humana."*

### 09.7 — Logs Insights queries (CloudWatch como fallback)

**Goal:** documentar 10 queries Logs Insights que repliquen lo que hacías en Datadog (top endpoints, error breakdown, requests por user, traces de una correlation ID). Commit en `infra/log-queries.md`.

**Concepto clave:** Datadog es para semana 9-10. Después del trial, CloudWatch Logs Insights es lo que queda. Las queries son tu cuaderno operacional.

**Deep-dive a Claude Code:** *"Escribe 10 queries Logs Insights cubriendo: top endpoints por latency, error rate por servicio, requests por correlation ID, top users por requests, jobs failed en últimas 24h. Sintaxis Logs Insights con ejemplos."*

### 09.8 — RUM o Synthetic monitoring (opcional)

**Goal:** Datadog Synthetic checks que hacen requests periódicos a endpoints clave desde múltiples regions. Alerta si la latency externa o disponibilidad bajan.

**Concepto clave:** RUM/synthetic = "lo que ven los usuarios". Métricas internas pueden estar verdes pero si CloudFront/DNS está roto, los usuarios no llegan.

**Deep-dive a Claude Code:** *"Configura un Synthetic check en Datadog: HTTP GET a /health/ready cada 1 min desde us-east-1 y sa-east-1. Alerta si falla 3 veces seguidas. Documenta por qué synthetic complementa monitors internos."*

## Decisiones a tomar en esta épica

- **Trial Datadog vs alternativa permanente:** **Datadog ahora**, después del trial CloudWatch + opcional Grafana Cloud free para mantener algunos dashboards.
- **Sampling rate APM en prod:** **10%** para reservas (alto volume), **100%** para errors (siempre). Datadog soporta esta config.
- **PII en logs:** **redact** emails, tokens, payment data. Pino tiene `redact` config.
- **Métricas push (dogstatsd) vs pull (OpenMetrics/Prometheus):** **push (dogstatsd)** porque encaja con Datadog. Si usaras Grafana, prometheus pull.

## AWS services touched

- **CloudWatch Logs** ✓
- **CloudWatch Metrics** ✓ (métricas custom de CloudWatch como fallback de DD)
- **CloudWatch Alarms** ✓ (como fallback de monitors)
- **SNS** (para que alarmas notifiquen email/slack)
- **X-Ray** (opcional como alternativa a DD APM)

## Definition of Done

- [ ] Logs estructurados van a Datadog Y CloudWatch
- [ ] APM activo con auto-instrumentation funcionando (verificable en UI de DD)
- [ ] Custom spans en use cases críticos con tags semánticos
- [ ] 5+ métricas custom emitidas y visibles en Datadog
- [ ] 3 dashboards creados, exportados como JSON, commiteados
- [ ] 5+ monitors con runbook docs en el repo
- [ ] 10 queries Logs Insights documentadas
- [ ] Correlation ID se propaga a traces, logs, jobs (verificable)
- [ ] PII redactado (test con un payload que contiene email — assert que el log no lo expone)

## Interview signal post-épica

- Tres pilares de observability + por qué cada uno es necesario
- Sampling de traces y trade-offs cost vs visibility
- Cómo diseñar buenas métricas (RED method: Rate, Errors, Duration)
- Diferencia entre alerta accionable y métrica
- Cómo debuggar un incident usando logs + traces + metrics
- Correlation ID propagation cross-service

## Trampas comunes

- Loggear el body completo del request → PII leak + costo brutal.
- Dashboards bonitos sin métricas significativas (vanity metrics).
- Monitor con threshold copy-pasted de Datadog templates → flapping continuo.
- APM activado después de los requires → no instrumenta nada, silencioso.
- Alertas vía email único → ignoradas. Usa PagerDuty / Slack channel dedicado.
- Synthetic check al endpoint público sin auth → cualquier outsider que lo descubra tira métricas falsas.
- Quemar el trial de DD antes de la épica.
