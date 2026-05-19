# Booking Platform AWS — Proyecto de práctica senior

Plataforma de reservas tipo Airbnb construida como ejercicio de portfolio para entrevistas senior backend Node + AWS en LATAM. Diseñada deliberadamente como _overkill educativo_: integra patterns que rara vez se usan todos juntos en un mismo proyecto, pero que individualmente son los que más se preguntan en entrevistas.

## Por qué existe este proyecto

Después del Sprint 1 del AWS Fast Track (IAM, VPC, S3, CloudWatch, Lambda, API GW, Cognito, DynamoDB, RDS), este proyecto consolida todo en un sistema realista. La diferencia con el "Task Manager v1" del capstone del workbook: este es más rico en dominio (concurrencia real, state machines, workflows async) y empuja a profundizar en clean architecture, observabilidad y patterns enterprise.

## Stack final

**Backend core**

- Node 20+ con TypeScript strict (sin `any`, sin `// @ts-ignore`)
- Express con clean architecture manual (4 capas: domain / application / infrastructure / interfaces)
- Prisma + PostgreSQL
- Redis (Upstash en cloud, Docker en dev) para cache, distributed locks, rate limiting, BullMQ
- Zod para validación + schemas como source of truth (incluye OpenAPI auto-generado)
- Pino para logs estructurados con correlation IDs

**AWS (estrategia híbrida)**

- API REST principal en **ECS Fargate** detrás de **API Gateway HTTP API**
- **Lambdas** para event handlers (S3 events, DynamoDB streams), cron jobs, image processing
- **RDS PostgreSQL** en subnet privada con **RDS Proxy** para connection pooling
- **S3** para attachments con presigned URLs
- **Cognito** User Pool para auth (después de implementar JWT propio para entender el concepto)
- **EventBridge** + **SQS** para eventos cross-service y jobs (refactor desde BullMQ)
- **Secrets Manager** para creds, **CloudWatch** como observabilidad fallback
- **CDK TypeScript** para toda la infraestructura

**Observability**

- Datadog APM + Logs (trial 14 días, activado en épica 09 para no quemar el trial)
- Pino structured logs con correlation ID propagation
- CloudWatch Logs Insights como fallback permanente
- Métricas custom (reservations/min, latency p50/p99, error rate)

**Testing & Quality**

- Vitest + Supertest + Testcontainers (Postgres real, no mocks)
- ESLint + Prettier + Husky + lint-staged + commitlint (conventional commits)
- GitHub Actions con OIDC trust hacia AWS (sin long-lived keys)

**Dominio: Plataforma de reservas (Airbnb-lite)**

- Hosts publican listings (propiedades) con calendarios de disponibilidad
- Guests buscan, hacen _holds_ temporales (TTL en Redis), confirman reservación con pago
- Concurrencia real: dos guests intentando reservar el mismo slot al mismo tiempo
- State machines: `pending → held → confirmed → checked_in → completed | cancelled`
- Workflows async: confirmaciones por email, recordatorios, expiración de holds, payouts a host

## Cómo navegar este repo

Cada épica vive en `epics/epic-XX-nombre/README.md`. Las épicas están ordenadas de simple a complejo y casi todas dependen de la anterior — sigue el orden salvo que sepas lo que haces.

```
epics/
├── epic-00-setup/             # Skeleton TS + clean arch + Docker + healthcheck
├── epic-01-persistence/       # Prisma + Postgres + repository pattern + Testcontainers
├── epic-02-auth/              # JWT propio + argon2id, después migración a Cognito
├── epic-03-listings/          # CRUD + búsqueda con filtros + cache Redis + OpenAPI
├── epic-04-reservations/      # Holds con TTL, distributed locks, state machine, idempotency
├── epic-05-async-jobs/        # BullMQ + workers + retries + DLQ
├── epic-06-rate-limit-locks/  # Sliding window, Redlock, circuit breaker
├── epic-07-domain-events/     # Event bus interno → outbox pattern → EventBridge
├── epic-08-s3-uploads/        # Presigned URLs + Lambda image processor (S3 trigger)
├── epic-09-observability/     # Datadog APM + métricas custom + dashboards + alertas
├── epic-10-aws-deploy/        # CDK: VPC + RDS + RDS Proxy + ECS Fargate + ALB + API GW
├── epic-11-ci-cd/             # GitHub Actions OIDC + migrations en pipeline + smoke tests
└── epic-12-hardening/         # Webhooks outgoing, API versioning, k6 load test, security review
```

Cada épica tiene la misma estructura:

- **Goal** — qué skill demuestra y por qué importa para interview
- **Pre-requisitos** — qué épicas previas deben estar completas
- **Overview conceptual** — 2-3 párrafos del problema y el approach
- **Tickets** — lista numerada con goal + concepto clave + qué pedirle a Claude Code para deep-dive
- **Decisiones a tomar** — los puntos donde hay trade-off real
- **AWS services touched** — checkbox de lo que tocas
- **Definition of Done** — qué tiene que estar verde antes de pasar
- **Interview signal** — qué debes poder defender en whiteboard después

## Cadencia sugerida

No hay deadline duro porque tú llevas el ritmo, pero como referencia: si haces 10-12 hrs/sem, las 13 épicas caben en ~8-10 semanas. Las épicas 04, 07, 09 y 10 son las que te van a tomar más tiempo (concurrencia, eventos, observabilidad, deploy real).

Recomendación importante: **commit + push al final de cada épica** con un README explicando qué decisiones tomaste y qué trade-offs evaluaste. El portfolio no es el código, es la capacidad de defender el código.

## Documentos de referencia

- [`architecture.md`](architecture.md) — diagrama del sistema completo, decisiones arquitectónicas (ADRs ligeros)
- [`stack.md`](stack.md) — justificación de cada elección de stack y alternativas consideradas
- [`epics/README.md`](epics/README.md) — índice de épicas con dependencias visualizadas

## Costos

Presupuesto: $100 USD de AWS Free Plan + free tiers permanentes de Upstash, Datadog (trial), GitHub Actions.

Lo más caro corriendo es: NAT Gateway (~$32/mes), RDS db.t3.micro (~$13/mes), ECS Fargate (~$15/mes idle). **Apaga todo lo que no estés usando activamente.** Cada épica que toca infra incluye un recordatorio de qué destruir al cerrar.
