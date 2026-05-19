# Epic 02 — Auth & Identity

**Estimación:** 4 sesiones (~10 hrs). La épica más densa de las primeras.

## Lectura paralela (guía de aprendizaje)

Lee la sección **`Épica 02 · Auth & Identity`** del documento [`aprendizaje-senior.html`](../../aprendizaje-senior.html) (raíz del proyecto). Cubre: la desambiguación JWT vs OAuth 2.0 vs OIDC, anatomía de un JWT (claims y por qué validar iss/aud), RS256 vs HS256, argon2id vs bcrypt, refresh token rotation + reuse detection, timing attacks en login, JWKS caching, IdToken vs AccessToken.

**Cuándo leerlo:**
- **Antes** de empezar: la desambiguación de los 3 protocolos y JWT internals
- **Durante** los tickets: la sección de cada concepto al implementarlo
- **Después** de terminar: las 5 preguntas de entrevista + 2 ejercicios "rómpelo" (timing attack + reuse detection, con prompt copy-paste)

## Goal

Implementar autenticación dos veces: primero con **JWT propio + argon2id** para entender cada pieza, después migrar a **AWS Cognito** verificando JWTs remotamente con JWKS.

Conocer auth a este nivel es lo que separa mid de senior en interview. Las preguntas clásicas — *"¿qué hay dentro de un JWT?"*, *"¿por qué refresh tokens?"*, *"¿cómo revocas un token?"*, *"¿bcrypt vs argon2 vs scrypt?"* — todas se contestan después de implementarlo a mano.

## Pre-requisitos

- Epic 01 completo (necesitas la entidad User en DB)

## Overview conceptual

### JWT vs OAuth 2.0 vs OIDC — la desambiguación que casi nadie hace

Tres conceptos que se mezclan constantemente en interview y en código:

- **JWT** es un **formato de token** (`header.payload.signature`, autocontenido, firmado con RS256/HS256). No dice nada sobre cómo lo obtienes ni para qué se usa.
- **OAuth 2.0** es un **framework de autorización**. Define flows (Authorization Code, PKCE, Client Credentials, Device Code) para que un sistema acceda a otro en nombre del usuario. El access token que OAuth produce *puede* ser JWT o string opaco — el spec no obliga.
- **OIDC (OpenID Connect)** se construye encima de OAuth 2.0 y añade **autenticación** (saber quién es el usuario), no solo qué puede hacer. Introduce el `id_token` (siempre JWT).

**En esta épica el token es JWT siempre — lo que cambia entre fase 1 y fase 2 es cómo lo obtienes:**

| | Fase 1: JWT propio | Fase 2: Cognito |
|---|---|---|
| Formato del token | JWT (RS256) | JWT (RS256) |
| Cómo se obtiene | Flow casero: `POST /auth/login` con email+password → tu API valida y firma | OAuth 2.0 Authorization Code + PKCE: cliente → Hosted UI → code → exchange |
| Quién emite | Tu API | Cognito |
| Refresh token | JWT firmado por ti, rotation manual | String opaco emitido por Cognito |
| Validación en API | Verificas tu propia firma con tu llave pública | Verificas firma de Cognito con JWKS público |

**TL;DR:** JWT es el formato. OAuth 2.0 es el protocolo de obtención. Cognito implementa OAuth/OIDC y emite JWTs; tu JWT propio NO usa OAuth, solo aprovecha el formato.

### Las tres dimensiones de auth

Auth tiene tres dimensiones que se confunden constantemente:

1. **Authentication (authn):** ¿quién eres? (login)
2. **Authorization (authz):** ¿qué puedes hacer? (permissions, roles)
3. **Session management:** ¿cómo recordamos que eres tú? (tokens, cookies)

El flow JWT estándar:
- Cliente manda credenciales → server devuelve `accessToken` (15 min TTL) + `refreshToken` (7 días TTL).
- Cliente manda `accessToken` en cada request en `Authorization: Bearer <token>`.
- Cuando `accessToken` expira, cliente usa `refreshToken` para obtener un nuevo par.
- `refreshToken` con **rotation**: cada uso lo invalida y emite uno nuevo. Si alguien usa un refresh viejo, sabes que fue robado → invalidas toda la familia.

Passwords se hashean con **argon2id** (no bcrypt, no MD5/SHA por amor de Dios). Argon2id es resistente a GPU/ASIC attacks; bcrypt está aceptable pero argon2id ganó el password hashing competition.

Cognito te quita todo este dolor pero introduce otro: cómo verificar el JWT que te llega. La respuesta es **JWKS**: Cognito publica las llaves públicas en una URL bien conocida (`/.well-known/jwks.json`). Tu API descarga las llaves, las cachea, y valida la firma localmente. Sin red en el critical path.

Una pieza menos obvia: **IdToken vs AccessToken** en Cognito. AccessToken es para tu API (lo que valida tu authorizer); IdToken es información de identidad para el cliente. Confundirlos es bug clásico.

## Tickets

### 02.1 — Password hashing con argon2id

**Goal:** módulo `infrastructure/auth/password-hasher.ts` que expone `hash(password)` y `verify(password, hash)`. Usa `argon2` npm package con parámetros recomendados (memory cost 64MB, iterations 3, parallelism 1) — adjustable por env.

**Concepto clave:** los parámetros de argon2 son trade-off seguridad vs latencia. Default razonable: ~150ms por hash en hardware moderno. Si tu signup tarda 2s, redúcelos; si tu hardware es muy potente, súbelos.

**Deep-dive a Claude Code:** *"Implementa hasher de passwords con argon2id en infrastructure/auth. Parámetros configurables vía env. Justifica argon2id vs argon2i vs argon2d, y por qué no bcrypt. Documenta cómo medir si tus parámetros son adecuados para tu hardware."*

### 02.2 — JWT propio: signing + verification

**Goal:** signing con RS256 (asymmetric, no HS256). Generar par RSA al boot o cargar desde Secrets Manager (mock con env por ahora). Funciones `signAccessToken(payload)`, `signRefreshToken(payload)`, `verifyToken(token)`.

**Concepto clave:** RS256 vs HS256: RS256 permite que terceros verifiquen sin compartir el secret. HS256 es simétrico — adoptable solo si verificar y firmar viven en el mismo proceso. RS256 es lo que usa Cognito, así que la migración será trivial.

**Deep-dive a Claude Code:** *"Implementa firma y verificación de JWT con RS256 en infrastructure/auth. Generación de par RSA, carga desde env (mock de Secrets Manager). Funciones para access token y refresh token con TTLs diferentes. Justifica RS256 vs HS256 y por qué importa para Cognito después."*

### 02.3 — Use cases: signup, login, refresh, logout

**Goal:** 4 use cases en `application/use-cases/auth/`:
- `Signup`: valida input, hashea password, crea User, devuelve par tokens.
- `Login`: busca user por email, verifica password (incluso si no existe — para evitar timing attack), devuelve par tokens.
- `Refresh`: valida refreshToken, busca en DB, lo rota (invalida el viejo, emite uno nuevo), devuelve par tokens.
- `Logout`: invalida refreshToken (lo borra de DB o marca revoked).

**Concepto clave:** "timing attack" en login — si haces `if (!user) return early`, atacantes miden response time para detectar emails registrados. Siempre haz el hash check incluso si user es null (con un hash dummy precomputado).

**Deep-dive a Claude Code:** *"Implementa los use cases de signup, login, refresh con rotation, logout. Incluye prevención de timing attacks en login. Refresh tokens almacenados en DB (tabla refresh_tokens) con familyId para detección de uso de token robado. Justifica cada decisión de seguridad."*

### 02.4 — Refresh token rotation + reuse detection

**Goal:** tabla `refresh_tokens` con `id`, `userId`, `familyId`, `tokenHash`, `expiresAt`, `usedAt`. Cada vez que se usa un refresh: marca `usedAt`, emite uno nuevo con mismo `familyId`. Si llega un refresh con `usedAt != null`, **revoca toda la familia** (alguien robó un token).

**Concepto clave:** rotation reduce ventana de exposición. Reuse detection convierte un breach en señal — sabes que pasó algo y puedes responder.

**Deep-dive a Claude Code:** *"Implementa refresh token rotation con detección de reuso. Si un refresh token ya usado se presenta otra vez, invalida toda la familia (todos los refresh emitidos a ese usuario). Explica el modelo de amenazas que esto cubre."*

### 02.5 — Middleware de auth + extracción de claims

**Goal:** middleware `requireAuth` que:
1. Extrae `Bearer <token>` del header `Authorization`.
2. Verifica firma + claims (`exp`, `iss`, `aud`).
3. Adjunta `req.user = { id, email, role }` (tipado con declaration merging de Express).

**Concepto clave:** declaration merging tipado de `req.user`. NO uses `(req as any).user`. Crea un `.d.ts` que extienda `Express.Request`.

**Deep-dive a Claude Code:** *"Crea middleware Express requireAuth que valida JWT, adjunta user al request tipado (con declaration merging, sin any), y rechaza con 401 estructurado en caso de inválido/expirado. Test cases: token válido, expirado, firma mala, header ausente."*

### 02.6 — RBAC simple (guest / host / admin)

**Goal:** middleware `requireRole(...roles)` que verifica que `req.user.role` está en la lista. Aplicable por route. Roles persistidos en `User.role` (enum). Para chequeos por recurso ("solo el dueño puede editar este listing") es check en el use case, no en middleware.

**Concepto clave:** RBAC por route es check de capability (verbo). Ownership check es check de instance (resource). Combinarlos en un solo middleware es antipattern.

**Deep-dive a Claude Code:** *"Implementa RBAC con middleware requireRole. Define roles guest/host/admin. Separa estrictamente capability checks (middleware) de ownership checks (use case). Da 3 ejemplos donde la distinción importa."*

### 02.7 — Migración a Cognito User Pool

**Goal:** crear Cognito User Pool en AWS Console (o CDK stub). Configurar app client sin secret (para SPA). En la API: instalar `aws-jwt-verify`, reemplazar la verificación local por verificación contra JWKS de Cognito. El middleware sigue igual, solo cambia el verifier.

**Concepto clave:** JWKS caching. La librería ya lo hace pero hay que entenderlo: descargas las llaves públicas una vez, cacheas, refrescas cuando aparece un `kid` (key ID) desconocido en un token.

**Deep-dive a Claude Code:** *"Migra la verificación de JWT propio a Cognito User Pool usando aws-jwt-verify. Configura JWKS caching, verificación de AccessToken (no IdToken). Diferencia los dos tokens y cuál usar en qué caso. Mantén el resto del código intacto — solo el verifier cambia."*

### 02.8 — Cognito hosted UI (opcional pero recomendado)

**Goal:** habilitar Cognito Hosted UI con dominio AWS gratis. Tu API ya no maneja login UI — Cognito hace signup/login/forgot password.

**Concepto clave:** OAuth 2.0 Authorization Code flow con PKCE. Tu API solo valida tokens; Cognito hace toda la UX. Bonus para entrevista: puedes hablar de PKCE.

**Deep-dive a Claude Code:** *"Habilita Cognito Hosted UI con Authorization Code + PKCE flow. Documenta el flow paso a paso desde el cliente. Explica PKCE y por qué reemplazó al implicit flow en SPAs."*

## Decisiones a tomar en esta épica

- **Refresh token en cookie httpOnly vs body:** **cookie httpOnly + SameSite=Strict** para web. Body si es API-first (mobile/CLI). En esta práctica, body porque es API-only — pero documenta cuándo cambiarías.
- **JWT en sessionStorage vs localStorage:** discusión clásica. **Recomendado:** access token en memoria (variable), refresh en cookie httpOnly. Pero como esto es API, lo dejas para el cliente.
- **Cuándo migrar de JWT propio a Cognito:** **inmediatamente después de validar que JWT propio funciona end-to-end**. No te quedes con dos sistemas conviviendo más de una sesión.

## AWS services touched

- **Cognito User Pool + App Client** (épica 10 lo formaliza con CDK; aquí se configura por consola por velocidad)
- **Secrets Manager** (mock con env, real en épica 10)

## Definition of Done

- [ ] Signup, login, refresh, logout funcionan con JWT propio
- [ ] Argon2id hashea passwords con parámetros documentados
- [ ] Refresh rotation + reuse detection con tests que demuestran detección
- [ ] Middleware `requireAuth` + `requireRole` aplicados a endpoints de prueba
- [ ] Tests integration cubren: signup duplicado, login wrong password, refresh expirado, refresh reuso, token inválido
- [ ] Cognito User Pool creado y migración hecha
- [ ] Token de Cognito valida y pasa por el mismo middleware
- [ ] README documenta cómo obtener un token con curl + Cognito Hosted UI

## Interview signal post-épica

- Diferencia entre auth, authz, session management
- Por qué argon2id vence a bcrypt
- Cómo funciona refresh token rotation y qué protege
- RS256 vs HS256 y cuándo cada uno
- IdToken vs AccessToken en Cognito
- Por qué JWKS y cómo se cachea
- Cómo prevenir timing attacks en login

## Trampas comunes

- Usar HS256 con un secret hardcoded — clásica vulnerability.
- Olvidar verificar `iss` y `aud` claims — token de Cognito de OTRO user pool sería aceptado.
- Almacenar refresh tokens en plain text en DB — guarda el hash.
- No invalidar refresh al logout — token sigue válido aunque el user "cerró sesión".
- Confundir IdToken con AccessToken al hacer el authorizer — Cognito acepta ambos en formato, pero usar IdToken para auth de API es semánticamente incorrecto.
- Middleware `requireAuth` que devuelve 403 en lugar de 401 — 401 es "no autenticado", 403 es "autenticado pero no autorizado".
