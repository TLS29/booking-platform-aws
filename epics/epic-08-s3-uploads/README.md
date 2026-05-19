# Epic 08 — S3 Uploads + Lambda Image Processing

**Estimación:** 2 sesiones (~6 hrs).

## Lectura paralela (guía de aprendizaje)

Lee la sección **`Épica 08 · S3 + Lambda`** del documento [`aprendizaje-senior.html`](../../aprendizaje-senior.html) (raíz del proyecto). Cubre: las 3 alternativas de upload y por qué presigned URL gana, por qué el límite de tamaño va en la firma y no en el handler (con el daño que evita), Lambda cold start a fondo (por qué el API principal NO usa Lambda), S3 events + DLQ con alarma, Block Public Access como única default sana.

**Cuándo leerlo:**
- **Antes** de empezar: presigned URLs + límite en la firma
- **Durante** los tickets: cold start al configurar la Lambda image-processor
- **Después** de terminar: las preguntas de entrevista + ejercicio "rómpelo" (presigned sin condition de tamaño, con prompt copy-paste)

## Goal

Primera integración real con AWS. Hosts suben fotos de sus listings vía **presigned URL** (sube directo a S3 sin pasar por la API). Una **Lambda** triggered por el evento `s3:ObjectCreated:*` procesa la imagen (resize, thumbnails) y actualiza la DB.

Aquí tocas: S3 buckets con bucket policies, presigned URLs, S3 event notifications, Lambda con SAM o CDK, IAM roles para Lambda, y el pattern "API responde rápido, Lambda hace el trabajo pesado en background".

## Pre-requisitos

- Epic 07 (eventos para que el image processor publique `ImageProcessed`)
- Cuenta AWS configurada con MFA, IAM user, billing alerts (del setup del workbook AWS)

## Overview conceptual

**¿Por qué presigned URL?** Tres alternativas para upload:
1. **Cliente → API → S3**: la API recibe el byte stream y lo reenvía. Funciona, pero el byte stream pasa por tu cómputo (caro, lento, limita throughput).
2. **Cliente → S3 directo con creds embebidas**: terrible idea de seguridad.
3. **Cliente pide presigned URL a la API → cliente sube a S3 con esa URL**: API solo firma una URL de corta duración (5 min). El upload bypassa la API. Esto es el estándar.

**¿Por qué Lambda para procesar?** Procesar imágenes en el API:
- Bloquea event loop (sharp es nativo pero igual taking ~200ms por imagen).
- Si el guest sube 10 imágenes, son 2 segundos de latencia.
- Si tu API crashea, el procesamiento se pierde.

Lambda triggered por S3 event:
- Asíncrono, no bloquea al usuario.
- Auto-escalable (10 imágenes = 10 Lambdas en paralelo).
- Si falla, S3 reenvía (con DLQ a SQS).
- Free tier de Lambda es muy generoso para esto.

**El flow completo:**
```
1. Cliente: POST /listings/{id}/photos/upload-url → API devuelve { uploadUrl, photoId }
2. Cliente: PUT uploadUrl con el archivo → S3 acepta directo
3. S3 evento: ObjectCreated → Lambda image-processor se invoca
4. Lambda: lee imagen, resize a thumbnail + medium + large, guarda en S3
5. Lambda: actualiza tabla Photos en RDS (o publica evento que un consumer escribe a RDS)
6. Cliente: poll o WebSocket para ver "procesado"
```

## Tickets

### 08.1 — S3 bucket con CDK

**Goal:** stack CDK que crea el bucket `booking-platform-photos-{env}`. Configuración:
- Versioning ON
- Block public access ALL (acceso siempre vía signed URL o CloudFront)
- Encryption SSE-S3 (free)
- Lifecycle: mover originales a Glacier a 90 días
- Bucket policy que solo permite HTTPS

**Concepto clave:** Block Public Access debe ir desde el día 1. La cantidad de buckets públicos accidentales es legendaria.

**Deep-dive a Claude Code:** *"Crea un stack CDK que provisione un bucket S3 con versioning, encryption SSE-S3, Block Public Access total, bucket policy solo HTTPS, lifecycle a Glacier a 90 días. Justifica cada setting con el riesgo que mitiga."*

### 08.2 — Presigned URL endpoint

**Goal:** endpoint `POST /listings/{listingId}/photos/upload-url`. Body: `{ contentType, sizeBytes }`. Validación: `contentType` en whitelist (image/jpeg, image/png, image/webp), `sizeBytes` ≤ 10MB.

Response: `{ photoId, uploadUrl, expiresAt }`. La `uploadUrl` es presigned PUT, válida 5 min.

Crear `Photo` record en DB con `status: 'pending_upload'`, `s3Key`, `uploadedAt: null`.

**Concepto clave:** límite de tamaño es **del lado del servidor en la firma** (`ContentLength` condition). Sin esto, el cliente podría subir 1GB.

**Deep-dive a Claude Code:** *"Implementa POST /listings/{id}/photos/upload-url. Valida ownership (solo el host del listing). Genera presigned URL con condition de tamaño máximo. Crea Photo record en DB con estado pending. Justifica TTL de 5 min y por qué el límite va en la firma."*

### 08.3 — Lambda image-processor con CDK + SAM

**Goal:** Lambda en `lambdas/image-processor/handler.ts`. Definida en el CDK stack con:
- Trigger: S3 event `ObjectCreated:*` sobre el bucket.
- Runtime: Node 20, memory 1024MB (para `sharp`).
- IAM role: read del bucket, write del bucket, conexión a RDS (Secrets Manager).
- Timeout: 60s.

El handler:
1. Parse event, obtiene S3 key.
2. Download imagen.
3. Resize a 3 sizes (thumbnail 200px, medium 800px, large 1600px) con `sharp`.
4. Upload a S3 con keys derivadas.
5. Update Photo en DB con `status: 'processed'`, URLs de los sizes.
6. Publica evento `ImageProcessed`.

**Concepto clave:** Lambda con dependencias nativas (sharp) requiere build correcto. CDK `NodejsFunction` con esbuild + `nodeModules: ['sharp']` lo maneja. Layer alternativa.

**Deep-dive a Claude Code:** *"Define una Lambda image-processor en el CDK stack triggered por S3 PUT. Maneja la dependencia nativa de sharp (NodejsFunction con nodeModules excluido + Lambda Layer). Handler: download, resize a 3 sizes, upload, update DB, publish event. Memory 1024MB, timeout 60s. Justifica esos valores."*

### 08.4 — Lambda con acceso a RDS via Secrets Manager

**Goal:** la Lambda necesita acceder a RDS Postgres. Configuración:
- Lambda en VPC private subnet (acceso a RDS subnet).
- Security group permite outbound a RDS port 5432.
- Lambda IAM role tiene `secretsmanager:GetSecretValue` para el secret de la DB.
- Cold start optimization: connection pool con `pg` simple (no Prisma — too heavy).

**Concepto clave:** Lambda en VPC históricamente fue lento al inicializar. Desde 2019 es mucho mejor pero igual cuesta unos cientos de ms. La alternativa para data writes es publicar a SNS/EventBridge y un consumer fuera de VPC escribe a DB. Para esto proyecto, Lambda en VPC es OK.

**Deep-dive a Claude Code:** *"Configura Lambda image-processor en VPC private subnet con acceso a RDS. Carga DB creds desde Secrets Manager (con cache). Usa pg directo (no Prisma). Justifica el trade-off de Lambda en VPC vs Lambda + EventBridge + worker."*

### 08.5 — DLQ para Lambda

**Goal:** configurar DLQ (SQS) para la Lambda. Si después de retries (2 retries por default para async invocations) sigue fallando, el evento va a la DLQ. Crear CloudWatch alarm que dispare cuando la DLQ tiene > 0 mensajes.

**Concepto clave:** DLQ sin alarma = mensajes mueren silenciosos. La alarma cierra el loop de observabilidad.

**Deep-dive a Claude Code:** *"Añade DLQ (SQS) a la Lambda image-processor. Configura retry policy explícita. CloudWatch alarm que se dispara cuando hay mensajes en DLQ → SNS topic → email. Justifica por qué DLQ aplica a async invocations y cómo se diferencia de error handling síncrono."*

### 08.6 — Frontend mock o curl flow

**Goal:** script `scripts/test-upload-flow.ts` que demuestra el flow end-to-end:
1. Login con curl/cognito.
2. Crea listing.
3. POST upload-url.
4. PUT imagen real (download a stock photo de placeholder).
5. Poll GET listing hasta que aparezca processedAt.
6. Verifica que las 3 sizes existen en S3.

**Concepto clave:** sin un test E2E del flow completo, no sabes si funciona. Este script lo hace.

**Deep-dive a Claude Code:** *"Escribe un script TS scripts/test-upload-flow.ts que ejecute el flow completo de upload + processing end-to-end. Usa una imagen de stock. Reporta success/failure con detalles. Comparte código del request al backend con su mismo cliente HTTP."*

### 08.7 — CloudFront frente al bucket (opcional)

**Goal:** distribución CloudFront que sirve las imágenes procesadas. URL pública pero el bucket sigue privado (Origin Access Identity).

**Concepto clave:** CloudFront cachea en edge, reduce latencia y costo de S3 GET. Para imágenes de listing, esencial.

**Deep-dive a Claude Code:** *"Añade CloudFront distribution frente al bucket con OAI (Origin Access Identity). Bucket sigue privado, CloudFront es la única forma de acceso público para imágenes procesadas. Custom cache behaviors para distintos size keys."*

## Decisiones a tomar en esta épica

- **Procesar en API o Lambda:** **Lambda** sin pregunta. API solo firma URLs.
- **`sharp` en Lambda: layer o `nodeModules`:** **`nodeModules` excluido + Layer** o bundling cuidadoso. `sharp` necesita binarios nativos compatible con Lambda Linux.
- **CloudFront sí o no:** **sí en prod, opcional en dev**. Free tier de CloudFront es 1TB/mes egress los primeros 12 meses — gratis para este ejercicio.
- **Multipart upload:** **no necesario** para 10MB. Si el límite subiera a 100MB+, sí.

## AWS services touched

- **S3** ✓
- **Lambda** ✓
- **IAM** (role para Lambda) ✓
- **CloudWatch** (logs de Lambda + alarmas DLQ) ✓
- **SQS** (DLQ) ✓
- **Secrets Manager** ✓
- **CloudFront** (opcional)
- **VPC** (Lambda en private subnet — formal en épica 10)

## Definition of Done

- [ ] Bucket S3 provisioned via CDK con todas las security best practices
- [ ] POST upload-url devuelve presigned URL con tamaño/tipo limitado
- [ ] PUT del cliente sube directo a S3
- [ ] Lambda procesa la imagen y crea 3 sizes
- [ ] Photo en DB actualizado con URLs procesadas
- [ ] DLQ + alarma configuradas
- [ ] Script E2E ejecuta el flow completo end-to-end
- [ ] **Apagaste lo que cobra** después de validar (S3 cobra muy poco, queda OK encendido)

## Interview signal post-épica

- Cuándo usar presigned URLs y por qué
- Límite de tamaño en la firma vs en el handler
- Lambda async invocation retry + DLQ flow
- Por qué procesar imágenes fuera del request path
- CloudFront + OAI para servir contenido privado

## Trampas comunes

- Presigned URL sin condition de `ContentLength` → cliente sube TB.
- Lambda sin VPC pero accediendo a RDS público → security hole. Lambda en VPC SIEMPRE para RDS privado.
- `sharp` bundled como pure-JS → falla en Lambda (necesita native binary correcto).
- Lambda timeout demasiado bajo → fail on large images. 60s es buen default para imágenes ≤ 10MB.
- Olvidar DLQ → fallos invisibles.
- Bucket policy permite S3:GetObject público "por simplicidad" → leak de datos privados.
