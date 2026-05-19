# Epic 11 — CI/CD con GitHub Actions + OIDC

**Estimación:** 3 sesiones (~8 hrs).

## Lectura paralela (guía de aprendizaje)

Lee la sección **`Épica 11 · CI/CD`** del documento [`aprendizaje-senior.html`](../../aprendizaje-senior.html) (raíz del proyecto). Cubre: **OIDC trust GitHub ↔ AWS** (los 4 problemas que mata vs AWS keys long-lived), el patrón **expand-contract** para migrations sin downtime (cada paso backwards-compatible), pre-migration dry-run + safety checks, smoke tests post-deploy vs E2E vs integration, estrategias de rollback (image vs task definition revision vs blue/green).

**Cuándo leerlo:**
- **Antes** de empezar: OIDC trust + expand-contract
- **Durante** los tickets: smoke tests al diseñar el post-deploy
- **Después** de terminar: las preguntas de entrevista + ejercicio "rómpelo" (migration destructiva sin expand-contract, con prompt copy-paste)

## Goal

Automatizar el ciclo: push → tests → build → deploy. Eliminar long-lived AWS keys del CI usando **OIDC trust** (GitHub Actions asume role en AWS sin keys). Migrations de DB en pipeline con safety checks. Smoke tests post-deploy.

Esto es lo que separa un proyecto "que se deploya" de uno "que se opera". En interview, "cómo desplegamos" es pregunta directa.

## Pre-requisitos

- Epic 10 (infra deployada al menos una vez manualmente para validar)
- Repo en GitHub con permisos para crear secrets/workflows

## Overview conceptual

### OIDC trust GitHub → AWS
Approach tradicional: guardar `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` como secret en GitHub. Problemas: keys long-lived, leak en logs, rotation manual, blast radius brutal.

Approach correcto: **OIDC**. GitHub firma un JWT por job que contiene info del repo, branch, environment. AWS confía en GitHub como OIDC provider y permite que ese JWT sea swap por temp credentials (STS AssumeRoleWithWebIdentity). Sin keys persistentes.

Setup:
1. Crear OIDC provider en IAM (one-time): `token.actions.githubusercontent.com`.
2. Crear role con trust policy que acepta tokens del OIDC provider Y restringe por `sub` claim (ej. `repo:jonathan/booking-platform-aws:ref:refs/heads/main`).
3. En workflow: `aws-actions/configure-aws-credentials@v4` con `role-to-assume`.

### Pipeline stages
```
push to PR ────► lint + type-check + unit + integration → status
                                                          ↓
                                                       (block merge if fail)

merge to main ──► CI (same as PR) ──► build image ──► push ECR ──► migrate DB ──► deploy dev ──► smoke tests
                                                                                              ↓
                                                                                       manual approval
                                                                                              ↓
                                                                                          deploy prod ──► smoke tests
```

### Migrations safety
Migrations son potencialmente destructivas. Defensas:
- **Dry-run** primero (`prisma migrate diff` muestra qué haría sin aplicar).
- **Lock**: solo un pipeline puede correr migrations a la vez (advisory lock).
- **Forward-only**: no rollback automático (rollback = nuevo deploy).
- **Backwards-compatible**: deploy A (que escribe ambos schemas) → migrate → deploy B (que limpia el viejo). "Expand-contract pattern".

### Smoke tests
Post-deploy, ejecuta requests críticos contra el env recién deployado:
- `/health/ready` responde 200.
- Login + crear reservation + cancelar funciona end-to-end.

Si falla → rollback automático (CDK redeploy stack anterior, o `aws ecs update-service` con task definition vieja).

## Tickets

### 11.1 — OIDC provider + IAM role en AWS

**Goal:** crear OIDC provider para GitHub Actions en IAM (CDK construct `OpenIdConnectProvider`). Crear role `github-actions-deploy` con trust policy condicionada por `sub` y `aud`.

**Concepto clave:** la condition `sub: repo:owner/repo:ref:refs/heads/main` previene que cualquier repo asuma tu role (importante en organizations).

**Deep-dive a Claude Code:** *"Crea OIDC provider y deploy role en CDK. Trust policy con condiciones estrictas: solo el repo X, solo branch main O environment 'prod', `aud: sts.amazonaws.com`. Permisos mínimos: deploy CDK, push ECR, update ECS, run migrations. Justifica cada condition."*

### 11.2 — Workflow CI (lint + test + build) en PRs

**Goal:** `.github/workflows/ci.yml` que en cada PR:
1. Checkout, setup pnpm + Node 20.
2. Install (cached).
3. Lint + type-check.
4. Unit tests.
5. Integration tests con Testcontainers (services: postgres, redis).
6. Build (verifica que compila).

Falla → bloquea el merge.

**Concepto clave:** caché de pnpm. Sin cache, install demora 60s; con cache, 5s. Multiplica por 50 builds/semana.

**Deep-dive a Claude Code:** *"Workflow ci.yml para PRs: lint, type-check, unit, integration con Testcontainers, build. Caché de pnpm con hash de pnpm-lock.yaml. Matrix de Node si quieres. Justifica orden de pasos (fail-fast: lint primero, integration al final)."*

### 11.3 — Workflow CD para dev

**Goal:** `.github/workflows/deploy-dev.yml` triggered por push a `main`:
1. Re-run CI suite.
2. Build Docker image, tag con `<git-sha>`.
3. Push a ECR.
4. Ejecutar migrations vía one-off ECS task (`aws ecs run-task`).
5. Update ECS service `desiredCount` con la nueva task definition.
6. Esperar deployment estable (`aws ecs wait services-stable`).
7. Smoke tests.

**Concepto clave:** `wait services-stable` bloquea hasta que el deployment alcanza el desiredCount con health checks OK. Sin esto, smoke tests corren contra el estado viejo.

**Deep-dive a Claude Code:** *"Workflow deploy-dev.yml: build, push ECR, migrate DB via one-off task, update ECS service, wait stable, smoke tests. Cada paso falla → rollback. Justifica el paso de migración como tarea separada del API."*

### 11.4 — Workflow CD para prod con approval

**Goal:** `.github/workflows/deploy-prod.yml` con GitHub Environment `prod` que requiere approval manual. Cuando aprueban, corre los mismos pasos que dev contra los stacks de prod.

**Concepto clave:** "environment protection rules" de GitHub permite approvals, branch restrictions, secrets per-env. Production debe SIEMPRE requerir approval — incluso de ti mismo, evita merge accidentales.

**Deep-dive a Claude Code:** *"Workflow deploy-prod.yml con GitHub Environment 'prod', protection rule de required reviewers, secrets específicos del environment. Justifica por qué prod siempre debe requerir aprobación humana y cómo evitar 'me-approve' bypass."*

### 11.5 — Migrations en pipeline con dry-run

**Goal:** antes de aplicar, generar diff con `prisma migrate diff --from-url $DB_URL --to-schema-datamodel`. Si el diff contiene `DROP TABLE`, `DROP COLUMN`, o `ALTER COLUMN ... NOT NULL`, fallar con mensaje claro (requiere migration explícita de dos pasos).

**Concepto clave:** "expand-contract" para migrations breaking: deploy expand (añade nueva columna, código escribe ambas) → migrate → backfill → deploy contract (código solo usa nueva, drop vieja).

**Deep-dive a Claude Code:** *"Implementa pre-migration safety check en CI: detecta operaciones destructivas en el diff, falla con mensaje que explique el patrón expand-contract. Lista operations que requieren manual review."*

### 11.6 — Smoke tests post-deploy

**Goal:** script `scripts/smoke-tests.ts` que ejecuta:
- `GET /health/ready` (expect 200).
- Login con usuario seed (creds en GH secrets).
- `POST /reservations/hold` (expect 201).
- `DELETE /reservations/{id}` (cleanup).

Falla → workflow falla → automated rollback.

**Concepto clave:** smoke tests son **few but critical**. No es full e2e; son los path mínimos para decir "el deploy no rompió producción".

**Deep-dive a Claude Code:** *"Implementa smoke tests minimalistas: health check + login + crear hold + cleanup. TS standalone, timeouts cortos. Justifica qué SÍ y qué NO incluye un smoke test (vs e2e completo)."*

### 11.7 — Rollback automático en falla

**Goal:** si smoke tests fallan, workflow ejecuta rollback: `aws ecs update-service` con la task definition anterior (guardada antes del deploy).

**Concepto clave:** rollback es "deploy a la versión anterior", no "undo". ECS guarda historia de task definitions; usas la version anterior por número.

**Deep-dive a Claude Code:** *"Implementa rollback automático en ECS: antes de update, captura la revision actual de task definition. Si smoke tests fallan, update-service apuntando a la revision anterior. Justifica esta estrategia vs rollback de imagen (más lento)."*

### 11.8 — Branch protection + required checks

**Goal:** configurar en GitHub:
- Branch `main` protected.
- Required status checks: `ci` debe pasar.
- Require linear history.
- Require signed commits (opcional).
- No force push.

**Concepto clave:** sin branch protection, todo lo demás es teatro — alguien puede merge a main sin pasar CI.

**Deep-dive a Claude Code:** *"Documenta cómo configurar branch protection en main: required checks, linear history, no force push, require signed commits si aplica. Por qué cada regla."*

## Decisiones a tomar en esta épica

- **GitHub Environments vs branches:** **environments** con protection rules para prod. Permite approvers configurable, secrets per-env.
- **Rolling deploy vs blue/green:** **rolling** para Fargate (built-in). Blue/green con CodeDeploy es más sofisticado pero más complejo — overkill aquí.
- **Test runner en CI:** **Vitest** ya está. GitHub Actions runner standard `ubuntu-latest`.
- **Cache strategy:** **pnpm + Docker layers + CDK assets** todos cacheados independiente.

## AWS services touched

- **IAM** (OIDC provider + role) ✓
- **STS** (AssumeRoleWithWebIdentity) ✓
- **ECR** (push images) ✓
- **ECS** (update service) ✓

## Definition of Done

- [ ] OIDC trust configurado; deploy role asumible solo desde el repo correcto
- [ ] PR workflow corre y bloquea merge si falla
- [ ] Push a main triggers deploy-dev automático
- [ ] Push a main NO deploya prod sin approval
- [ ] Migrations corren como pre-step y fallan loud en operations destructivas
- [ ] Smoke tests corren post-deploy
- [ ] Rollback automático demostrado (rompe a propósito, verifica que rollback)
- [ ] Branch protection activado en main
- [ ] README documenta cómo hacer un deploy manual (emergencias)

## Interview signal post-épica

- OIDC trust GitHub ↔ AWS y por qué bate keys long-lived
- Expand-contract migration pattern
- Por qué rolling vs blue/green
- Smoke tests vs e2e tests vs integration tests
- Cómo proteger production de deploys accidentales
- Rollback strategies en containers

## Trampas comunes

- OIDC trust con `sub` demasiado permisivo (`*` o sin condition) → cualquier repo de GitHub puede asumir.
- Secrets en logs por imprimirlos sin querer (`echo $SECRET`) → leak permanente.
- Migrations corriendo en boot del task → race conditions con múltiples tasks.
- Smoke tests sin timeout → cuelgan el workflow.
- No guardar el task def previo → no puedes rollback.
- Branch protection sin "require up-to-date" → merge de PR viejo deja main inconsistente.
- Workflow corre con permisos read+write a TODA AWS → escope down con least privilege.
