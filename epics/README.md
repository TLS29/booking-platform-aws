# Índice de épicas

Las épicas están diseñadas para hacerse en orden. Cada una asume que las anteriores están completas.

## Mapa de dependencias

```
Epic 00 (Setup)
    │
    ▼
Epic 01 (Persistence) ──────┐
    │                       │
    ▼                       │
Epic 02 (Auth) ─────────────┤
    │                       │
    ▼                       │
Epic 03 (Listings) ─────────┤
    │                       │
    ▼                       │
Epic 04 (Reservations) ◄────┘  ← punto crítico de concurrencia
    │
    ├──► Epic 05 (Async Jobs)
    │         │
    │         ▼
    ├──► Epic 06 (Rate limit + locks)
    │         │
    │         ▼
    ├──► Epic 07 (Domain events + outbox)
    │         │
    │         ▼
    ├──► Epic 08 (S3 + Lambda)
    │         │
    │         ▼
    ▼         ▼
Epic 09 (Observability) ─── puede mezclarse con 10 ───┐
    │                                                 │
    ▼                                                 │
Epic 10 (AWS deploy real) ◄───────────────────────────┘
    │
    ▼
Epic 11 (CI/CD)
    │
    ▼
Epic 12 (Hardening + polish)
```

## Listado con foco por épica

| # | Épica | Foco principal | Skill que demuestra en interview |
|---|-------|----------------|----------------------------------|
| 00 | Setup & Foundations | TS strict, clean arch, Docker, healthcheck | Disciplina de proyecto |
| 01 | Persistence | Prisma, repository pattern, Testcontainers | Datos relacionales bien modelados |
| 02 | Auth & Identity | JWT propio → Cognito, RBAC | Seguridad y auth real |
| 03 | Listings + Search | CRUD, búsqueda, cache, OpenAPI | API design |
| 04 | Reservations | Race conditions, locks, state machine | **Concurrencia distribuida (clave senior)** |
| 05 | Async Jobs | BullMQ, retries, DLQ | Event-driven patterns |
| 06 | Rate limit + locks | Sliding window, Redlock, circuit breaker | Resiliencia |
| 07 | Domain events | Outbox pattern, EventBridge | Sistemas distribuidos confiables |
| 08 | S3 + Lambda | Presigned URLs, S3 triggers, image processing | Servicios AWS event-driven |
| 09 | Observability | Datadog APM, métricas custom, alertas | Operability senior |
| 10 | AWS deploy real | VPC, RDS Proxy, ECS Fargate, CDK | Infra real |
| 11 | CI/CD | GitHub Actions OIDC, migrations, smoke tests | DevOps senior |
| 12 | Hardening | Webhooks, idempotency hardening, k6, security | Production-readiness |

## Tiempo estimado (12 hrs/sem)

| Épicas | Tiempo |
|--------|--------|
| 00-02 | 1 semana (setup intensivo) |
| 03-04 | 1.5 semanas (04 es densa) |
| 05-07 | 2 semanas (jobs + locks + events) |
| 08 | 0.5 semana |
| 09 | 1 semana (observability bien hecho lleva tiempo) |
| 10 | 1.5 semanas (deploy real toma más de lo que crees) |
| 11-12 | 1 semana |

**Total:** ~9 semanas a ritmo de 12 hrs/sem. Si vas a 8 hrs/sem, ~12 semanas.

## Cómo trabajar una épica

1. Lee el README de la épica entera antes de empezar
2. Confirma que cumples los pre-requisitos
3. Para cada ticket, abre una sesión nueva con Claude Code CLI y pídele que profundice ese ticket específico (los .md son intencionalmente conceptuales, no specs)
4. Al terminar cada ticket: commit con conventional commits (`feat(reservations): add hold TTL with Redis`)
5. Al terminar la épica: tachar el Definition of Done y push a GitHub
6. Pasa a la siguiente solo cuando el DoD esté 100% verde

**No saltes épicas.** El proyecto es overkill pedagógico, pero el orden está diseñado para construir comprensión incremental.
