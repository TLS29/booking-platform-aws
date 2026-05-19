# Epic 00 — Setup & Foundations

**Estimación:** 2-3 sesiones de trabajo (~6 hrs).

## Lectura paralela (guía de aprendizaje)

Lee la sección **`Épica 00 · Setup & Foundations`** del documento [`aprendizaje-senior.html`](../../aprendizaje-senior.html) (raíz del proyecto). Cubre: liveness vs readiness (con ejercicio "rómpelo"), AsyncLocalStorage para correlation ID, config fail-fast al boot, multi-stage Docker, preguntas de entrevista con respuesta esqueleto, y gotchas.

**Cuándo leerlo:**
- **Antes** de empezar: los conceptos overview
- **Durante** los tickets: los gotchas relevantes
- **Después** de terminar: las preguntas de entrevista + ejercicio "rómpelo" (con prompt copy-paste para practicar conmigo en sesión separada)

## Goal

Levantar el esqueleto del proyecto con todas las decisiones de tooling tomadas y enforced desde el día 1. Todo el resto del proyecto se construye encima de esto, así que vale invertir en hacerlo bien.

El objetivo no es tener una app funcional — es tener un repo donde _cualquier cosa_ que escribas a partir de aquí cumple las reglas: TS strict, tipos en todos lados, errores manejados centralmente, configuración validada, capas de clean architecture separadas con un guardrail automático.

## Pre-requisitos

- Cuenta de GitHub con repo público creado (sugerencia: `booking-platform-aws`)
- Node 20+ y pnpm instalados
- Docker Desktop corriendo
- VS Code con extensiones ESLint, Prettier, Prisma, Error Lens

## Overview conceptual

La trampa de empezar un proyecto serio es saltar el setup ("luego lo arreglo"). En este proyecto el setup _es_ la primera demo de skill senior: alguien que ve este repo en 30 segundos debe poder concluir "esta persona sabe lo que hace" antes de leer una sola línea de dominio.

Las capas de clean architecture (`domain` / `application` / `infrastructure` / `interfaces`) no son convención mental — son carpetas con un lint rule que prohíbe que `domain` importe de `infrastructure`. Si esa regla no se enforza automáticamente, se rompe en la épica 3 y nadie se da cuenta.

El healthcheck no es decorativo. Va a ser usado por el load balancer en producción para decidir si tu task está sana. Liveness != readiness: liveness dice "el proceso está vivo", readiness dice "el proceso está listo para recibir tráfico" (cosas como DB reachable, Redis reachable). Hay que distinguirlos desde el día 1.

## Tickets

### 00.1 — Inicialización del repo con TS strict

**Goal:** crear `package.json` con todos los scripts (`dev`, `build`, `start`, `lint`, `test`, `migrate`), `tsconfig.json` con strict máximo (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`), `.editorconfig`, `.gitignore`, `.nvmrc`.

**Concepto clave:** `noUncheckedIndexedAccess: true` es el flag que más se olvida — hace que `arr[0]` devuelva `T | undefined` en lugar de `T`. Sin esto, half tu type safety es ficticia.

**Deep-dive a Claude Code:** _"Inicializa el proyecto en `./` con pnpm, TypeScript strict, Node 20, scripts npm completos para una API Express con clean architecture. Configura tsconfig con los strict flags más agresivos. Justifica cada flag."_

### 00.2 — Clean architecture skeleton con guardrails

**Goal:** crear las carpetas `src/domain`, `src/application`, `src/infrastructure`, `src/interfaces` con `index.ts` placeholders. Configurar `dependency-cruiser` o `eslint-plugin-boundaries` para enforzar la regla de dependencia (domain no importa de nadie, application solo de domain, infrastructure e interfaces de ambas).

**Concepto clave:** la regla automática es lo que separa una arquitectura "aspiracional" de una "vivida". Si rompes la regla, falla el lint y por consecuencia el CI.

**Deep-dive a Claude Code:** _"Configura dependency-cruiser para enforzar las reglas de dependencia de clean architecture en este repo. Documenta cada regla con un comentario explicando qué se previene."_

### 00.3 — Config tipada con Zod

**Goal:** crear `src/infrastructure/config/env.ts` que lea `process.env`, lo valide con un schema Zod, y exporte un objeto `env` tipado. El proceso debe crashear al boot si falta una variable o tiene el formato incorrecto (mejor crash temprano que bug en producción).

**Concepto clave:** "fail-fast" en boot. En lugar de tener `process.env.DB_URL!` esparcido por el código, todo accede a `env.databaseUrl` (tipado, validado, defaulted donde aplique).

**Deep-dive a Claude Code:** _"Crea un módulo de configuración tipada con Zod que valide al boot todas las variables del proyecto. Incluye: DATABASE_URL, REDIS_URL, JWT_SECRET, AWS_REGION, COGNITO_USER_POOL_ID, NODE_ENV. Documenta qué pasa si una falta o es inválida."_

### 00.4 — Logger estructurado con Pino + correlation ID

**Goal:** instalar Pino, configurarlo para output JSON estructurado en prod y pretty en dev. Crear middleware Express que genere `X-Correlation-Id` si no viene en el request, lo guarde en AsyncLocalStorage, y enriquezca todo log dentro del request scope con ese ID.

**Concepto clave:** correlation ID propagation es lo que hace que puedas trazar una request a través de múltiples servicios. Sin AsyncLocalStorage tendrías que pasar el logger por parámetro a todo (terrible).

**Deep-dive a Claude Code:** _"Configura Pino con AsyncLocalStorage para correlation ID propagation transparente. Cada log debe incluir `correlationId`, `userId` (cuando hay auth), `method`, `path`. Output JSON en prod, pretty en dev."_

### 00.5 — Express skeleton + error handler centralizado

**Goal:** boot mínimo de Express (`src/interfaces/http/app.ts` exporta el app, `src/main.ts` lo arranca). Middleware order: cors, json body parser, correlation ID, request logger, routes, 404, error handler central. Crear clase `DomainError` con `code`, `message`, `status` y un handler que la traduce a response JSON.

**Concepto clave:** un error handler central es la única forma sana de no repetir `try/catch` en cada controller. Express 4 necesita `next(err)` para que el handler centralizado lo capture; con async/await usas un wrapper o `express-async-errors`.

**Deep-dive a Claude Code:** _"Levanta un Express skeleton con todos los middlewares estándar en el orden correcto, error handler centralizado que distingue DomainError, validación errors de Zod, y errores no esperados (500). Estructura el código respetando clean architecture: el server vive en interfaces/http."_

### 00.6 — Healthcheck `/health` con liveness + readiness

**Goal:** dos endpoints: `GET /health/live` (siempre 200 si el proceso está vivo, sin checks de DB) y `GET /health/ready` (checa DB + Redis reachable, devuelve 200 o 503). El ALB usará `/ready`.

**Concepto clave:** liveness vs readiness. Liveness = "kill el container si fallo". Readiness = "no me mandes tráfico hasta que recupere". Confundirlos causa restart loops innecesarios.

**Deep-dive a Claude Code:** _"Implementa endpoints /health/live y /health/ready en Express. Live es trivial. Ready checa conectividad a Postgres y Redis con timeout corto. Devuelve 503 con detalle por servicio si algo falla. Justifica por qué hay dos endpoints."_

> ⚠️ **Estado parcial:** solo `/health/live` se implementó en esta épica. `/health/ready` se difirió a **epic-01** porque requiere conectividad a Postgres (y eventualmente Redis), que aún no existen. Hay un `TODO` en `src/interfaces/http/routes/health.ts` marcando dónde debe ir.

### 00.7 — Docker + docker-compose para dev

**Goal:** `Dockerfile` multi-stage para la API (dev y prod), `docker-compose.yml` con servicios `api`, `postgres`, `redis`. Volumes para hot reload de código y para persistencia de DB.

**Concepto clave:** multi-stage build reduce el size de la imagen final (sin dev deps, sin source TS). En prod el container corre `node dist/main.js`, no `tsx`.

**Deep-dive a Claude Code:** _"Crea Dockerfile multi-stage (builder + runtime) para Node 20 + TS, y docker-compose.yml con api/postgres/redis. Hot reload con tsx en dev. Healthcheck definido en compose. Justifica decisiones de seguridad (non-root user, signal handling)."_

### 00.8 — README inicial + diagrama objetivo

**Goal:** README del repo con: descripción 1 párrafo, cómo correr (`docker compose up`), estructura de carpetas, diagrama de arquitectura objetivo (puedes copiar de `architecture.md`). No detalles, solo orientación a quien aterriza.

**Concepto clave:** el README es lo primero que ven en una interview — debe responder "qué es esto" en 10 segundos.

## Decisiones a tomar en esta épica

- **Library de DI:** ¿hacemos DI manual (composition root en `main.ts`) o usamos tsyringe/awilix? **Recomendación:** DI manual al inicio (es lo que más enseña), si se vuelve doloroso refactorizamos a awilix en épica 04.
- **HTTP server:** ¿`http.createServer` envuelto o solo `app.listen`? **Recomendación:** `http.createServer` desde el día 1 para poder hacer graceful shutdown bien.
- **Graceful shutdown:** ¿lo metemos ahora o después? **Recomendación:** ahora (10 minutos extra, pero te ahorra dolor en épica 10 cuando ECS empieza a hacer rolling deploys).

## AWS services touched

Ninguno todavía. Esta épica es 100% local.

## Definition of Done

- [ ] `pnpm install` y `pnpm dev` funcionan
- [ ] `pnpm lint` pasa sin warnings
- [ ] `pnpm tsc --noEmit` pasa sin errores
- [ ] `docker compose up` levanta api, postgres, redis y los tres responden
- [ ] `curl localhost:3000/health/live` → 200
- [ ] `curl localhost:3000/health/ready` → 200 cuando Postgres y Redis están up; 503 cuando bajas Postgres
- [ ] Cada request genera correlation ID y aparece en los logs
- [ ] Si pones un `import` de `infrastructure` dentro de `domain`, el lint/dependency-cruiser falla
- [ ] Si arrancas sin `DATABASE_URL`, el proceso crashea al boot con mensaje claro
- [ ] README explica cómo correr en menos de 5 líneas
- [ ] Commit + push a GitHub con conventional commits

## Interview signal post-épica

Debes poder defender en 5 minutos:

- Por qué `noUncheckedIndexedAccess` es importante
- Por qué clean architecture necesita guardrails automáticos (no solo convención)
- Diferencia entre liveness y readiness probes
- Por qué correlation ID propagation no debe pasarse por parámetro
- Cómo crashear al boot por config inválida es mejor que validar en runtime

## Trampas comunes

- Usar `any` "temporal" en boot — nunca es temporal, se queda.
- Olvidar `noImplicitOverride` — métodos sobreescritos sin `override` keyword se rompen silenciosamente al refactorizar la clase base.
- Logger con `console.log` "por ahora" — te lo arrastras 4 épicas.
- `process.env.X!` (non-null assertion) en lugar de validación centralizada — buena suerte cuando algo es `undefined` en runtime.
- Dockerfile sin multi-stage — imagen de 1.2GB.
