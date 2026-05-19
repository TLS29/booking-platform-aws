# Arquitectura — Booking Platform AWS

## Diagrama del sistema (estado final, post-épica 12)

```
                              ┌─────────────────────────────┐
                              │  GitHub Actions (CI/CD)     │
                              │  OIDC trust → AWS           │
                              └──────────────┬──────────────┘
                                             │ deploy
                                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ AWS Account                                                                  │
│                                                                              │
│   Clients (web/mobile/curl)                                                  │
│        │                                                                     │
│        │ HTTPS + JWT (Cognito)                                               │
│        ▼                                                                     │
│   ┌─────────────────┐                                                        │
│   │  API Gateway    │  HTTP API + Cognito authorizer + throttling + WAF     │
│   │  HTTP API       │                                                        │
│   └────────┬────────┘                                                        │
│            │ VPC Link                                                        │
│            ▼                                                                 │
│   ┌─────────────────┐                                                        │
│   │  ALB (internal) │                                                        │
│   └────────┬────────┘                                                        │
│            ▼                                                                 │
│   ┌──────────────────────────────┐                                           │
│   │  ECS Fargate                 │   Express + clean arch                    │
│   │  Service: api                │   Node 20 + TS strict                     │
│   │  Tasks: 2-10 (autoscaling)   │   Logs → CloudWatch + Datadog            │
│   └─────┬──────┬──────┬──────┬──┘                                           │
│         │      │      │      │                                              │
│         ▼      ▼      ▼      ▼                                              │
│      ┌────┐ ┌────┐ ┌────┐ ┌──────────┐                                      │
│      │RDS │ │S3  │ │SQS │ │EventBdge │  Upstash Redis (fuera de AWS)        │
│      │Prox│ │    │ │    │ │          │  ↑ via TLS, IP allowlist             │
│      └─┬──┘ └──┬─┘ └─┬──┘ └────┬─────┘  │                                   │
│        │       │     │         │        │                                   │
│        ▼       │     ▼         ▼        │                                   │
│      ┌────┐    │  ┌──────┐  ┌──────┐    │                                   │
│      │RDS │    │  │Lambda│  │Lambda│    │                                   │
│      │PG  │    │  │worker│  │event │    │                                   │
│      │priv│    │  └──────┘  │router│    │                                   │
│      └────┘    │            └──────┘    │                                   │
│                ▼                        │                                   │
│             ┌──────┐                    │                                   │
│             │Lambda│ ← S3 trigger       │                                   │
│             │image │   (image resize)   │                                   │
│             │proc  │                    │                                   │
│             └──────┘                    │                                   │
│                                         │                                   │
│   ┌─────────────────────────────────────┴──────┐                            │
│   │  Cognito User Pool (auth)                  │                            │
│   │  Secrets Manager (DB creds, JWT keys)      │                            │
│   │  CloudWatch (logs + métricas + alarmas)    │                            │
│   │  X-Ray + Datadog APM (tracing distribuido) │                            │
│   └────────────────────────────────────────────┘                            │
│                                                                              │
│   VPC: 2 AZs, public subnets (ALB + NAT), private subnets (ECS, RDS, Lambda) │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Capas de Clean Architecture

```
src/
├── domain/                   # Reglas de negocio puras. SIN dependencias externas.
│   ├── entities/             # Listing, Reservation, User, Review (clases con métodos de negocio)
│   ├── value-objects/        # Money, DateRange, ReservationStatus
│   ├── events/               # Domain events (ReservationConfirmed, ListingPublished, ...)
│   ├── errors/               # Errores específicos del dominio (ListingNotAvailable, ...)
│   └── ports/                # Interfaces de repositories y servicios externos (NO implementaciones)
│
├── application/              # Use cases. Orquestan domain + ports. SIN HTTP ni DB.
│   ├── use-cases/            # CreateReservation, PublishListing, SearchListings, ...
│   ├── dtos/                 # Schemas Zod de entrada/salida de use cases
│   └── services/             # Application services (no son repos ni handlers)
│
├── infrastructure/           # Adapters concretos de los ports.
│   ├── persistence/          # Prisma repositories, migrations, mappers
│   ├── messaging/            # BullMQ, SQS, EventBridge publishers
│   ├── cache/                # Redis client + cache decorators
│   ├── auth/                 # Cognito JWT verifier, JWKS client
│   ├── aws/                  # S3 client, Secrets Manager loader
│   └── observability/        # Pino logger, Datadog tracer, metrics
│
└── interfaces/               # Puntos de entrada (delivery mechanisms).
    ├── http/                 # Express routes + controllers + middleware
    ├── workers/              # BullMQ workers, Lambda handlers
    └── jobs/                 # Cron entry points
```

**Regla de dependencia:** las flechas apuntan hacia adentro. `domain` no importa de nadie. `application` importa de `domain`. `infrastructure` e `interfaces` importan de `application` y `domain`. Esto se enforza con un `dependency-cruiser` config o un eslint rule.

## Decisiones arquitectónicas clave (ADRs ligeros)

### ADR-001: Express en ECS Fargate (no Lambda) para el API principal
**Decisión:** API REST core corre como Express en contenedor sobre ECS Fargate, no como Lambda detrás de API Gateway.

**Razones:**
- Cold start de Lambda con Prisma (+ JIT de Node) puede ser 800ms-2s — mata UX
- Connection pooling de Postgres es natural en proceso largo, no en Lambda
- Express tradicional es lo que se ve en JDs senior LATAM (NestJS o Express puro)
- Para entrevista, mostrar criterio de "Lambda para events, container para API" vale más que "todo serverless"

**Trade-off:** pagas la task de Fargate aunque no haya tráfico. Mitigación: scale-to-1 en dev, autoscaling 1-10 en prod.

### ADR-002: Lambda solo para event handlers, jobs y processors
**Decisión:** Lambda se reserva para: S3 events (image resize), SQS workers, EventBridge consumers, cron jobs (EventBridge schedule).

**Razones:** todos estos casos son event-driven, bursty, idle la mayor parte del tiempo — Lambda gana en costo y simplicidad.

### ADR-003: Redis externo (Upstash), no ElastiCache
**Decisión:** Upstash Redis serverless en su free tier (256MB, 10k commands/día), no ElastiCache.

**Razones:** ElastiCache no tiene free tier real. Upstash basta para todo el ejercicio (cache, locks, rate limit, BullMQ). En producción real evaluarías ElastiCache.

### ADR-004: BullMQ primero, SQS después
**Decisión:** Implementamos jobs async con BullMQ + Redis (épica 05), después refactorizamos a SQS + Lambda workers para una parte (épica 07).

**Razones:** BullMQ enseña mejor el modelo de queue/worker en proceso. Migrar a SQS después muestra criterio para elegir entre "queue dentro del cluster" y "queue managed cross-service".

### ADR-005: JWT propio antes de Cognito
**Decisión:** Épica 02 implementa auth con JWT firmado localmente + argon2id antes de migrar a Cognito.

**Razones:** Cognito es una caja negra si no entiendes JWT. Implementarlo a mano una vez evita interview blunders ("¿qué es exp en un JWT?", "¿por qué refresh tokens?").

### ADR-006: Outbox pattern para eventos transaccionales
**Decisión:** Eventos del dominio se persisten en una tabla `outbox` dentro de la misma transacción que el cambio de estado, y un job aparte los publica a EventBridge.

**Razones:** sin outbox, un crash entre `commit` y `publish` pierde eventos. Es la respuesta correcta a la pregunta "¿cómo garantizas que si confirmas una reservación se envía el email?".

### ADR-007: CDK TypeScript para IaC
**Decisión:** Toda la infraestructura en AWS CDK con TypeScript. No SAM, no Terraform.

**Razones:** mismo lenguaje que la app. Type safety en la infra. Aparece más en JDs senior que SAM. Terraform sería más portable pero AWS-first es el escenario de práctica.

## Convenciones

- **Idempotency:** todo endpoint mutador acepta `Idempotency-Key` header (UUID v4). El servidor almacena el resultado durante 24h y devuelve el mismo response si ve la misma key.
- **Correlation ID:** middleware genera `X-Correlation-Id` si no viene, lo propaga a logs, downstream HTTP, mensajes de queue.
- **Errores:** clase `DomainError` con `code` (machine-readable), `message` (human), `status` (HTTP). Handler central traduce a response JSON estándar (`{ code, message, details? }`).
- **Time:** todo en UTC en DB y en código. Conversión a timezone solo en presentación.
- **Money:** todo en cents (integer), nunca floats. Value object `Money(amount: number, currency: string)`.
