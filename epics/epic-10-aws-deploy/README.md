# Epic 10 — AWS Deploy Real: VPC + RDS + RDS Proxy + ECS Fargate + ALB

**Estimación:** 5-6 sesiones (~14 hrs). Subestimas el tiempo que toma deploy real. **Es la épica que más AWS budget consume.**

## Lectura paralela (guía de aprendizaje)

Lee la sección **`Épica 10 · AWS Deploy Real`** del documento [`aprendizaje-senior.html`](../../aprendizaje-senior.html) (raíz del proyecto). Cubre: networking 101 (public vs private subnets, NAT, por qué NAT es lo más caro), VPC endpoints (Gateway gratis vs Interface barato), **RDS Proxy** (qué problema específico de Lambda resuelve + auth IAM), Fargate vs Lambda para el API (ADR-001 explicado con tabla), task role vs execution role (principio de mínimo privilegio).

**Cuándo leerlo:**
- **Antes** de empezar: networking 101 + RDS Proxy
- **Durante** los tickets: task role vs execution role al definir IAM
- **Después** de terminar: las preguntas de entrevista + ejercicio "rómpelo" (pool exhaustion sin RDS Proxy, con prompt copy-paste)

## Goal

Llevar el proyecto de local a producción real en AWS, con toda la infraestructura como código (CDK TypeScript). Tocar VPC, security groups, RDS con Multi-AZ, RDS Proxy, ECS Fargate, ALB, API Gateway, Cognito, EventBridge, Secrets Manager.

**Esta épica es la que más cobra.** Sigue el patrón: levanta, valida, **tear down al cerrar sesión**. NAT Gateway + RDS + Fargate + ALB corriendo 24/7 se come tu budget en días.

## Pre-requisitos

- Epic 09 (observability bien configurada para validar el deploy)
- Cuenta AWS con $100 disponibles
- AWS CLI configurada con profile `learning`
- CDK Bootstrap ejecutado en tu account/region (`cdk bootstrap`)
- Cognito User Pool de épica 02 funcionando

## Overview conceptual

### Stack de infraestructura
Vamos a tener 4-5 stacks CDK independientes (no un mega-stack):
1. `NetworkStack`: VPC, subnets, route tables, NAT, VPC endpoints.
2. `DatabaseStack`: RDS PostgreSQL, RDS Proxy, Secrets Manager secret.
3. `ApiStack`: ECR repo, ECS cluster + service, task definition, ALB, target group.
4. `ApiGatewayStack`: API Gateway HTTP API + VPC Link + Cognito authorizer.
5. `EventsStack`: EventBridge custom bus + rules + Lambda consumers.

Stacks independientes = puedes `cdk deploy DatabaseStack` sin tocar network. Y permite tear down selectivo (apagar Fargate sin destruir VPC).

### Networking 101
- **VPC** /16 (~65k IPs).
- **2 AZs** para HA.
- **Public subnets** en cada AZ: para ALB y NAT.
- **Private subnets** en cada AZ: para ECS, RDS, Lambda. Sin acceso directo a internet.
- **NAT Gateway** en una public subnet: permite que private subnets salgan a internet (outbound only).
- **VPC Endpoints** (Gateway type para S3, Interface type para Secrets Manager): tráfico a esos servicios sin pasar por NAT — ahorras dinero y latencia.

### RDS Proxy: por qué importa
Lambdas y Fargate tasks pueden levantar muchas conexiones a Postgres. Postgres por default soporta ~100 conexiones — con 10 Lambdas × 5 conexiones cada una, peta. RDS Proxy es un connection pooler managed que multiplexa.

Sin RDS Proxy + Lambdas concurrentes = `too many clients already` con tráfico moderado. Con RDS Proxy = escala suave.

Trade-off: ~$9/mes y latencia +1-2ms.

### ECS Fargate
Fargate corre containers sin gestionar EC2. Tu container live en una **task definition** (qué imagen, recursos, env vars, network mode). El **service** mantiene N tasks corriendo, los registra en ALB target group, hace rolling deploys.

Para nuestro caso: 1 service `api` con 1-3 tasks (autoscaling según CPU/latency).

### API Gateway HTTP API frente a ALB
**¿Por qué API GW si ya tengo ALB?** Tres cosas:
1. **Cognito authorizer** built-in (sin tener que validar JWT en cada container).
2. **Throttling** managed.
3. **WAF** integration fácil.

Trade-off: +2-5ms latency, +costo (API GW HTTP API es $1/M requests, muy barato).

### Cuándo apagar qué
| Recurso | Cobra mientras | Tear down al cerrar |
|---------|---------------|---------------------|
| RDS db.t3.micro | siempre encendido | Sí, o pause con Aurora Serverless v2 |
| RDS Proxy | siempre encendido | Sí |
| ECS Fargate (1 task) | tasks corriendo | Sí (`desiredCount: 0`) |
| ALB | siempre | Sí |
| NAT Gateway | siempre | **SÍ — más caro de todo** |
| API Gateway | per-request | No (cobra solo si hay tráfico) |
| Cognito | per-MAU | No (free tier hasta 50k) |
| S3 | almacenamiento | No (centavos) |
| EventBridge | per-event | No |

**Mantra:** "al cerrar sesión, `cdk destroy NetworkStack` y compañía". CDK destruye en orden inverso de dependencias.

## Tickets

### 10.1 — CDK bootstrap + estructura de stacks

**Goal:** crear directorio `infra/cdk/` con CDK app. Define 5 stacks con sus dependencias declaradas (`network.exposeVpc() → database.useVpc(...)`).

Configurar contexto `dev` y `prod` con diferencias (instance sizes, multi-AZ, etc).

**Concepto clave:** CDK trabaja con stacks. Cross-stack references son automatic con `Fn.importValue`. Stacks pueden vivir en archivos separados pero comparten una `App`.

**Deep-dive a Claude Code:** *"Estructura un CDK app en infra/cdk/ con 5 stacks: NetworkStack, DatabaseStack, ApiStack, ApiGatewayStack, EventsStack. Define cross-stack references explícitas. Contexto dev/prod. Justifica esta separación vs mono-stack."*

### 10.2 — NetworkStack: VPC + subnets + NAT + endpoints

**Goal:** stack que crea:
- VPC `10.0.0.0/16`.
- 2 AZs.
- Public subnets `10.0.1.0/24`, `10.0.2.0/24`.
- Private subnets `10.0.10.0/24`, `10.0.11.0/24`.
- IGW para public subnets.
- 1 NAT Gateway en una public subnet (en prod serían 2 para HA — aquí 1 por costo).
- VPC Endpoint Gateway para S3.
- VPC Endpoint Interface para Secrets Manager, ECR, CloudWatch Logs.

**Concepto clave:** VPC Endpoints **ahorran dinero** — tráfico a S3/Secrets desde private subnet va por NAT por default (caro). Con endpoint, va por red AWS interna (gratis Gateway, barato Interface).

**Deep-dive a Claude Code:** *"Implementa NetworkStack en CDK con VPC custom (no usar Vpc.fromLookup default que crea cosas no deseadas). Subnets, NAT, IGW, route tables. VPC endpoints para S3 (Gateway) y Secrets/ECR/Logs (Interface). Justifica cada endpoint con el ahorro de costo o seguridad."*

### 10.3 — DatabaseStack: RDS + RDS Proxy

**Goal:** stack que crea:
- RDS PostgreSQL 16, `db.t3.micro`, Multi-AZ off (cost), encryption at rest ON, automated backups 7 días.
- En subnets privadas.
- Security group: solo permite 5432 desde el SG del ECS service y de la Lambda.
- Secret en Secrets Manager con auto-rotation OFF (rotation requiere Lambda en VPC).
- RDS Proxy frente a la instancia, auth IAM.

**Concepto clave:** auth IAM al RDS Proxy: Lambda/ECS task obtiene un token corto (~15 min) en lugar de un password. Si el role es revocado, acceso se corta. **Major seguridad upgrade vs password en env var.**

**Deep-dive a Claude Code:** *"Implementa DatabaseStack: RDS Postgres en private subnet, encryption, backups, security group restrictivo. RDS Proxy con auth IAM. Secret en Secrets Manager. Documenta el flow: ECS task asume role → llama Proxy con IAM token → Proxy autentica con DB. Cuándo activar auto-rotation."*

### 10.4 — ApiStack: ECR + ECS Fargate + ALB

**Goal:** stack que crea:
- ECR repo `booking-api`.
- ECS cluster + Fargate service `api`.
- Task definition: imagen `:latest`, 0.5 vCPU, 1GB, env vars desde Secrets Manager.
- IAM task role: permisos para RDS (via Proxy), S3 (read processed images bucket), EventBridge (put events), Cognito (verificar tokens).
- ALB en public subnets, target group apuntando a tasks en private subnets.
- ALB health check → `/health/ready`.
- Autoscaling 1-3 tasks por CPU > 70%.

**Concepto clave:** **task role vs execution role**. Execution role: permisos para que ECS pueda pull la imagen, escribir logs (Lambda equivalent: assume role para boot). Task role: permisos de la app misma (acceso a S3, etc).

**Deep-dive a Claude Code:** *"Implementa ApiStack con ECR repo, ECS Fargate service detrás de ALB. Task definition con health checks, env desde Secrets, log driver Datadog (sidecar) + CloudWatch fallback. Task role con least privilege. Autoscaling rules. Justifica la diferencia task role vs execution role."*

### 10.5 — Build + push de imagen + primera deploy

**Goal:** Dockerfile multi-stage de épica 00 ya está OK. Script `scripts/deploy.sh`:
1. `docker build -t booking-api:<git-sha> .`
2. ECR login.
3. `docker push <ecr-url>:<git-sha>`.
4. `aws ecs update-service` para forzar new deployment.

Migration de DB: `prisma migrate deploy` ejecutado como **one-off task** (no en cada deploy del API).

**Concepto clave:** migrations en deploy es delicado. Patterns: (1) one-off task antes del deploy, (2) init container, (3) hook en deploy pipeline. Recomendado: separar — failure de migration no debe matar deploy del API si el cambio es backwards-compatible.

**Deep-dive a Claude Code:** *"Script de build + push a ECR + force-redeploy de ECS service. Documenta el flow de migrations (one-off task ECS, no en cada API task boot). Justifica por qué no usar :latest tag en prod."*

### 10.6 — ApiGatewayStack: HTTP API + Cognito authorizer + VPC Link

**Goal:** stack que crea:
- HTTP API en API Gateway.
- VPC Link al ALB private.
- Cognito JWT authorizer aplicado a routes que requieren auth.
- Throttling 200 req/s burst, 100 req/s sustained.
- Stage `prod` con auto-deploy.

**Concepto clave:** HTTP API ($1/M) vs REST API ($3.5/M). HTTP API es ~70% más barato y soporta lo que necesitamos. REST API solo se justifica si necesitas request validation o caching de respuesta managed.

**Deep-dive a Claude Code:** *"Implementa ApiGatewayStack con HTTP API + VPC Link al ALB + Cognito authorizer. Cada route tiene authorizer o no (públicas vs privadas). Throttling configurado. Stage prod con auto-deploy. Justifica HTTP API vs REST API con números."*

### 10.7 — EventsStack: EventBridge custom bus + rules

**Goal:** stack que crea:
- Custom EventBridge bus `booking-platform`.
- Reglas: `ReservationConfirmed → Lambda send-email`, `ImageProcessed → Lambda update-search-index`, etc.
- Lambdas asociadas como targets.
- DLQs para cada Lambda.

Refactorizar el `EventBridgePublisher` stub de épica 07 con la implementación real (`PutEvents` API).

**Concepto clave:** event buses default son para AWS service events. Tu bus custom es para tus eventos de dominio. Naming consistente del bus (env prefix) es importante para no mezclar dev/prod.

**Deep-dive a Claude Code:** *"Implementa EventsStack con EventBridge custom bus, rules por evento, Lambda targets, DLQs. Refactor del EventBridgePublisher para usar PutEvents API real. Documenta el patrón de naming de events (Source.Aggregate.Verb) y por qué evitar bus default."*

### 10.8 — Tear-down script + budget verification

**Goal:** script `scripts/teardown.sh` que destruye los stacks en orden correcto. Script `scripts/check-budget.sh` que llama Cost Explorer API y reporta gasto del mes corriente.

**Concepto clave:** prevention is cheaper than cure. Un script de teardown que tomas el hábito de correr al cerrar sesión te ahorra cientos.

**Deep-dive a Claude Code:** *"Crea scripts/teardown.sh que destruya los stacks CDK en orden correcto (ApiGateway → Api → Database → Events → Network — inverso de creación). Y scripts/check-budget.sh que llama Cost Explorer API. Documenta el daily ritual."*

## Decisiones a tomar en esta épica

- **Multi-AZ on RDS:** **OFF** en este proyecto (single-AZ ~$13/mes, multi-AZ ~$26). Documenta cuándo activarías.
- **Fargate Spot vs On-Demand:** **On-demand** para el ejercicio. Spot tiene 70% descuento pero pueden matarte la task con 2 min de aviso — no vale para learning.
- **HTTP API vs REST API:** **HTTP API** salvo casos específicos.
- **CloudFront global vs ALB direct:** **API Gateway direct** para esto. CloudFront agregaría costo sin valor para una API.
- **CDK Construct level (L1/L2/L3):** **L2 por default**, L1 cuando L2 no expone una feature.
- **CDK Pipelines (CI/CD):** **no en esta épica** — la épica 11 lo cubre con GitHub Actions OIDC.

## AWS services touched

- **VPC** ✓
- **RDS PostgreSQL** ✓
- **RDS Proxy** ✓
- **ECS Fargate** ✓
- **ECR** ✓
- **ALB** ✓
- **API Gateway HTTP API** ✓
- **Cognito** (formalización via CDK) ✓
- **EventBridge** ✓
- **Lambda** (consumers) ✓
- **SQS** (DLQs) ✓
- **Secrets Manager** ✓
- **IAM** (roles) ✓
- **CloudWatch** ✓

## Definition of Done

- [ ] `cdk deploy` despliega los 5 stacks sin errores
- [ ] `https://<api-gw-url>/health/ready` responde 200
- [ ] Una request `POST /reservations` end-to-end funciona en cloud
- [ ] DB connections van por RDS Proxy (verificable con Performance Insights)
- [ ] Dashboard de Datadog/CloudWatch muestra el service en cloud
- [ ] EventBridge eventos fluyen y Lambdas consumers procesan
- [ ] `cdk destroy` apaga todo y verificas en Cost Explorer al día siguiente que no hay charges
- [ ] README de la épica con: comandos para deploy, link al dashboard, foto de la arquitectura desplegada

## Interview signal post-épica

- VPC design (public/private, NAT, endpoints)
- Por qué RDS Proxy y cuándo NO es necesario
- ECS task role vs execution role
- API Gateway HTTP API vs REST API con números
- Cómo se ejecutan migrations en pipeline de despliegue
- Cost-conscious design (qué cobra siempre, qué cobra solo bajo uso)

## Trampas comunes

- Olvidar `cdk destroy` al cerrar sesión → factura sorpresa.
- NAT en una sola AZ y service multi-AZ → si esa AZ cae, todo falla.
- Security group "todo abierto" porque "no funciona si no" → debugging real es identificar QUÉ puerto.
- Migrations en el boot del API container → corre N veces (una por task) y choca.
- Task role con `*:*` → cualquier breach es total.
- VPC endpoints sin policy → cualquier IAM principal en la VPC los puede usar.
- RDS Proxy sin auth IAM → password en env var = security smell.
- Olvidar exponer la image tag por env var → deploys del mismo `:latest` no fuerzan rollout.
