# Stack — Justificaciones y alternativas consideradas

Una nota por cada pieza del stack, con la razón por la que se eligió y qué alternativas se consideraron. Útil para defender decisiones en entrevista ("¿por qué elegiste X y no Y?" es la pregunta más común en una system design discussion).

## Lenguaje y runtime

**Elegido:** Node 20 LTS + TypeScript 5.x con `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `exactOptionalPropertyTypes: true`.

**Por qué:** la JD objetivo es senior backend Node. Strict mode al máximo demuestra disciplina; en interview, un proyecto sin `any` y con tipos en boundaries de DB/HTTP/queue se nota.

**Regla no negociable:** prohibido `any` y `// @ts-ignore`. Si necesitas escape hatch, usa `unknown` + type guards. Si una librería externa fuerza `any`, crea un wrapper tipado.

## HTTP framework

**Elegido:** Express 4 (no 5 todavía — 5 aún tiene rough edges en mayo 2026).

**Alternativas consideradas:**
- **NestJS:** más estructurado, DI built-in, decoradores. Lo descarté porque oculta cómo se hace clean architecture a mano — para interview, mostrar que entiendes los principios sin un framework opinado vale más.
- **Fastify:** más rápido, mejor TS. Igual de bueno; Express ganó porque es lo que se ve más en JDs LATAM.
- **Hono:** muy moderno, runtime-agnostic. Demasiado nuevo en hubs LATAM.

## Persistencia relacional

**Elegido:** PostgreSQL 16 + Prisma 5.x.

**Por qué Postgres:** RDS soporta Postgres, Prisma tiene first-class support, JSON columns para metadata flexible, `FOR UPDATE` para concurrency.

**Por qué Prisma:** type-safe queries, migrations en TS, schema declarativo. La crítica clásica ("Prisma genera queries no óptimas") la atacamos donde importa con `$queryRaw` tipado en hotspots.

**Alternativas:**
- **Drizzle:** más cercano a SQL, mejor performance. Lo evaluaría en un proyecto greenfield real, pero Prisma sigue dominando en JDs.
- **TypeORM:** quedó atrás vs. Prisma. Descartado.
- **Kysely:** query builder puro, sin ORM. Excelente, pero menos visible en JDs.

## Cache / locks / queue infrastructure

**Elegido:** Redis (Upstash en cloud free tier, Docker en dev).

**Usos en este proyecto:**
1. Cache de búsquedas (épica 03)
2. Distributed locks para concurrencia de reservaciones (épica 04, 06) con Redlock o variant
3. Sliding window rate limiter (épica 06)
4. Backing store de BullMQ (épica 05)

**Por qué Upstash:** serverless, free tier permanente sustancial (256MB / 10k commands día), conexión TLS por internet, REST API opcional.

**Alternativas:**
- **ElastiCache:** AWS-native, sin free tier real → caro para práctica.
- **Memcached:** sin pub/sub, sin Lua scripts, sin TTL granular. Descartado.
- **DragonflyDB:** drop-in Redis replacement, mejor performance. Mismo dolor: hay que hostear.

## Job queue

**Elegido:** BullMQ (sobre Redis) para épicas 05-08, refactor parcial a SQS + Lambda en épica 07.

**Por qué BullMQ primero:** modelo de queues con retries, DLQ, scheduled jobs, repeatable jobs es muy claro. Demuestras el patrón sin pagar AWS desde el día 1.

**Por qué SQS después:** SQS + Lambda es el patrón AWS-native managed. Aparece en todas las JDs. La migración parcial muestra criterio: jobs in-process (BullMQ) vs jobs cross-service (SQS).

## Validación y schemas

**Elegido:** Zod.

**Por qué:** un solo schema sirve para parsing runtime, tipos TS, y OpenAPI auto-generado (con `zod-to-openapi`). En interview, "single source of truth para validación" es un golpe alto.

**Alternativas:** Joi (sin tipos TS), Yup (más débil con discriminated unions), io-ts (más purista pero verboso), valibot (más nuevo, ecosistema más chico).

## Auth

**Elegido (final):** Cognito User Pool con JWT verificado localmente vía JWKS.

**Elegido (intermedio):** JWT propio firmado con RS256 + argon2id para passwords + refresh token con rotation. La épica 02 hace ambos: primero local, después migra a Cognito.

**Alternativas:**
- **Auth0:** más DX-friendly que Cognito pero no es AWS-native. Para el sprint AWS, Cognito.
- **Lucia / NextAuth:** session-based, muy bueno para apps con servidor stateful. Descartado por scope.
- **Clerk:** comercial-first, no encaja con el ejercicio.

## Observability

**Elegido:** Datadog (APM + Logs + RUM) en trial de 14 días para la épica 09, CloudWatch como permanent fallback.

**Por qué Datadog:** es lo que más se pide en JDs senior LATAM. El trial es suficiente para tocar APM, custom metrics, log search, monitors, dashboards. Después del trial, todo sigue funcionando con CloudWatch Logs Insights + CloudWatch Metrics.

**Alternativas free permanentes considerar:**
- **Grafana Cloud free:** 10k series Prometheus, 50GB logs, 50GB traces → muy generoso. Si quieres permanente, esta es la mejor opción.
- **New Relic free:** 100GB/mes ingest, sin tiempo límite. También buena.
- **OpenTelemetry self-hosted:** demasiado overhead para este ejercicio.

**Decisión final:** Datadog para el trial (skill marketable), seguido de CloudWatch + Grafana Cloud si quieres mantener el pipeline después.

## IaC

**Elegido:** AWS CDK con TypeScript.

**Por qué:** mismo lenguaje que la app, type safety en infra, abstrae CloudFormation sin perder poder. En JDs senior, CDK aparece tanto o más que SAM.

**Alternativas:**
- **SAM:** simpler para serverless-only. Descartado porque el proyecto es híbrido (no solo Lambdas).
- **Terraform:** portable cross-cloud, gold standard en muchas empresas. Si tu próxima JD lo pide, refactorizamos.
- **Pulumi:** filosofía similar a CDK pero multi-cloud. Buena alternativa, pero más nicho.
- **Serverless Framework:** legacy ya en 2026.

## Testing

**Elegido:** Vitest + Supertest + Testcontainers.

**Por qué Vitest:** más rápido que Jest, mejor TS support nativo, mismo API. Reemplazo drop-in en la mayoría de casos.

**Por qué Testcontainers:** integration tests con Postgres real en Docker — no mocks de DB. La JD senior siempre pregunta por testing strategy y "no mockeas la DB en integration tests" es una respuesta correcta.

**Estrategia:**
- Unit: use cases con repos mockeados (domain + application)
- Integration: repositories con Postgres real (Testcontainers)
- E2E: API con todo arriba (Docker compose) — un puñado de happy paths críticos
- Contract: schemas Zod garantizan contratos request/response

## Build & tooling

- **Package manager:** pnpm (más rápido, hoisting controlado).
- **Bundler para Lambda:** esbuild via CDK NodejsFunction.
- **Bundler local:** tsx para dev, tsc para build.
- **Lint:** ESLint con `@typescript-eslint`, plugin de `import`, regla de dependencias entre capas (eslint-plugin-boundaries o dependency-cruiser).
- **Format:** Prettier.
- **Git hooks:** Husky + lint-staged + commitlint (Conventional Commits).

## Costos esperados

| Servicio | Costo aprox/mes (idle) | Notas |
|----------|------------------------|-------|
| RDS db.t3.micro Multi-AZ off | ~$13 | Apagar fuera de sesiones de trabajo |
| ECS Fargate (1 task, 0.5 vCPU/1GB) | ~$15 | Desplegar solo en épica 10 en adelante |
| RDS Proxy | ~$9 | Solo durante semana de proxy |
| NAT Gateway | ~$32 | LO MÁS CARO. Apagar siempre que no uses |
| ALB | ~$16 | Tearing down después de validar |
| Cognito | $0 hasta 50k MAU | Tier muy generoso |
| S3 / Lambda / CloudWatch | <$2 | Carga de práctica no llega a free tier |
| Upstash Redis | $0 | Free tier |
| Datadog | $0 | Trial 14 días |
| GitHub Actions | $0 | 2000 min free / mes |

**Total cuidado:** si dejas NAT + RDS + Fargate + Proxy + ALB corriendo 24/7 sin pausar = ~$85/mes. Con los $100 te queda muy justo. Tear down al cerrar sesión.
