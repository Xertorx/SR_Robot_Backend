# 🤖 Sr Robot — Backend API (Node.js + Express)

API REST + WebSocket para **Sr Robot**, el marketplace que conecta clientes con técnicos de reparación. Implementa las historias de usuario del documento *“Sr Robot — Funcionalidades, Historias de Usuario y Guía Visual”* (HC, HT, HA, HX, HI) como un monolito modular.

> Los datos viven **en memoria** (se reinician al apagar el servidor) y se precargan con datos de prueba. La pasarela de pagos, SMS, correo y WhatsApp están **simulados** (se registran en el log); las interfaces ya están separadas en `src/services` para cambiarlos por proveedores reales.

## 🚀 Ejecución

```bash
npm install
cp .env.example .env     # opcional: hay valores por defecto
npm run dev              # o: npm start
npm test                 # pruebas end-to-end (node:test)
```

- API: `http://localhost:3000/api/v1` · Health: `GET /health`
- WebSocket: `ws://localhost:3000/chat/{conversationId}?token=<JWT>` y `ws://localhost:3000/events?token=<JWT>`
- Archivos subidos (fotos/video): `GET /uploads/<archivo>`

### Usuarios de prueba (contraseña `Password123!`)

| Rol | Correo |
|---|---|
| Cliente | `cliente@srrobot.com` |
| Técnicos (verificados) | `tecnico@srrobot.com` (Pro), `tecnico2@…` (Básico), `tecnico3@…` (Premium), `tecnico4@…` |
| Técnico en verificación | `tecnico5@srrobot.com` |
| Proveedor de repuestos | `proveedor@srrobot.com` |
| Administrador | `admin@srrobot.com` |

## 🧱 Estructura

```
src/
├── config/        env y arranque
├── constants/     roles, planes por defecto, máquina de estados de la orden
├── controllers/   capa HTTP (validación y respuesta)
├── middlewares/   auth JWT + roles, subida de archivos, errores
├── models/        store en memoria y datos semilla
├── routes/        endpoints por módulo
├── services/      reglas de negocio: órdenes, pagos/escrow, suscripciones,
│                  disponibilidad, matching, chat, disputas, tiempo real, recordatorios
└── utils/         fechas (zona horaria del negocio), geo (Haversine), validación
tests/e2e.test.js  flujos completos contra la app real, incluido WebSocket
```

## 🔐 Convenciones

- Autenticación: `Authorization: Bearer <accessToken>` (1 h). Renovación con `POST /auth/refresh` (refresh token rotativo, 30 días).
- El rol activo viaja en el token; un usuario puede ser cliente y técnico (`POST /auth/switch-mode`).
- Respuestas: `{ success, data, message?, meta? }`. Listas paginadas con `?page=&limit=` → `meta: { total, page, limit, pages }`.
- Errores: `{ success:false, message }` con 400 validación · 401 sin sesión · 403 sin permiso · 404 · 409 conflicto de estado.
- Dinero: enteros en la moneda del país (COP no tiene decimales).

## 📡 Endpoints por módulo

### M01 · Identidad (HC-01, HX-01, HI-06)
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/register` | Registro (requiere `acceptTerms: true`; roles `CLIENT`/`TECHNICIAN`/`SUPPLIER`) |
| POST | `/auth/login` | Correo o celular + contraseña |
| POST | `/auth/otp` · `/auth/verify` | OTP de 6 dígitos (5 min, 5 intentos). `/auth/otp/verify` es alias. En desarrollo la respuesta incluye `otpCode` |
| POST | `/auth/password/forgot` · `/auth/password/reset` | Recuperar acceso con OTP |
| POST | `/auth/refresh` · `/auth/logout` | Sesión persistente |
| GET/PUT/DELETE | `/auth/me` | Perfil, preferencias de canal, **eliminar cuenta** |
| GET | `/auth/me/export` | **Exportar datos** personales |
| GET/POST | `/auth/consents` | Registro de consentimientos (incl. opt-in de WhatsApp) |
| POST | `/auth/switch-mode` | Cambiar entre modo cliente y técnico |

### M02/M03 · Directorio y perfil del técnico (HC-02…05, HT-01…03)
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/technicians?lat&lng&cat&home&verified&minRating&q&radius&sort&page&limit` | Búsqueda geoespacial, ordenada por distancia real (km) |
| GET | `/technicians/:id` | Perfil público: servicios, horario, ubicación, reseñas y distribución |
| GET | `/technicians/:id/availability?date=YYYY-MM-DD` | Franjas libres reales |
| GET | `/technicians/:id/reviews` | Reseñas visibles |
| GET/PUT | `/technicians/me` | Mi negocio (datos, categorías, ubicación, radio de domicilio, disponibilidad) |
| GET/PUT | `/technicians/me/schedule` | Horario por día |
| POST/DELETE | `/technicians/me/blocks[/:id]` | Bloqueo de franjas |
| GET/POST/PUT/DELETE | `/technicians/me/services[/:id]` | CRUD de servicios (DELETE desactiva) |
| POST | `/technicians/me/documents` | Subir documentos (multipart `documents`, `type`: `ID`/`RUT`/`LOCAL_PHOTO`) — privados |
| POST | `/technicians/me/submit-verification` | Pasa a `IN_REVIEW` |
| GET | `/technicians/me/analytics?days=30` | Ingresos, comparativa, barras semanales, visitas, conversión |
| GET | `/technicians/me/wallet` · `/ledger` | Saldo retenido / disponible / retirado y libro de movimientos |
| GET/POST | `/technicians/me/withdrawals` | Retiros a cuenta o Nequi |

### M04 · Cotizaciones (HC-06…08, HT-04…06)
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/quote-requests` | JSON o **multipart** (`media`: fotos/video). Abierta (hasta 3 técnicos cercanos por categoría/distancia/plan) o dirigida con `targetTechnicianId`. Expira en 24 h |
| GET | `/quote-requests/mine` · `/quote-requests/received?status=new|quoted|accepted|rejected` | Cliente / técnico |
| GET | `/quote-requests/:id/quotes` | Ofertas con etiquetas `BEST_PRICE`, `BEST_RATED`, `FASTEST` |
| POST | `/quote-requests/:id/quotes` | Técnico cotiza (una sola vez) |
| POST | `/quote-requests/:id/reject` | Técnico rechaza sin afectar su reputación |
| POST | `/quote-requests/:id/quotes/:quoteId/accept` | Cliente acepta → crea la orden con el pago |
| POST | `/quote-requests/:id/cancel` | Cliente cancela |

Rutas anteriores (`/quotes/requests`, `/quotes`) siguen disponibles.

### M05 · Citas (HC-09, HC-17, HT-07)
`POST /appointments` (servicio, fecha, hora, `LOCAL`/`HOME`, dirección, `paymentMethod`; bloquea la franja y calcula el total con recargo de domicilio) · `GET /appointments?date&from&to&status` · `GET /appointments/:id` · `POST /appointments/:id/cancel` · `PATCH /appointments/:id/reschedule`. Recordatorio automático 24 h antes.

### M06 · Órdenes (HC-11…13, HT-07, HT-08)
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/orders?status=active|history&state=` · `/orders/:id` | Solo las órdenes del usuario; incluye línea de tiempo, desglose y garantía |
| POST | `/orders/:id/transitions` | `{ newState, note?, subState? }` validado por rol |
| POST | `/orders/:id/confirm-receipt` | Cliente confirma: libera pago y activa garantía |
| POST | `/orders/:id/cancel` | Política de reembolso según estado |
| POST | `/orders/:id/evidence` | Técnico sube fotos/notas de avance (multipart `media`) |
| POST | `/orders/:id/adjustments` · `…/:adjId/approve|reject` | Costo adicional con aprobación del cliente |
| POST | `/orders/:id/reviews` | Reseña verificada (solo orden `ENTREGADO`, una vez) |
| POST | `/orders/:id/disputes` | Abrir disputa con evidencias |

**Máquina de estados:** `SOLICITADO → DIAGNOSTICO → EN_REPARACION → LISTO → ENTREGADO`, con `CANCELADO` y `DISPUTA` como estados laterales. Subestados internos: `APROBACION_REPUESTO` (en diagnóstico) y `PRUEBAS_CALIDAD` (en reparación). Quién avanza: técnico → diagnóstico/reparación/listo · cliente → entregado/cancelar · cliente o técnico → disputa · admin → resolver disputa.

### M07 · Chat (HC-15, HT-09)
REST: `GET/POST /chat/conversations`, `GET/POST /chat/conversations/:id/messages` (adjuntos multipart `attachments`), `POST …/read`. Un hilo por cliente y negocio; contador de no leídos.
WebSocket `/chat/{id}?token=`: envía `{type:"message",text}`, `{type:"typing"}`, `{type:"read"}`; recibe `message`, `typing`, `read`. WebSocket `/events?token=`: `notification` y `unread` en tiempo real.

### M08 · Pagos, escrow y suscripciones (HC-10, HT-12, HT-14, HI-03/04)
- Métodos de pago según el país del usuario: `GET /payments/methods` (Colombia: `NEQUI`, `DAVIPLATA`, `CARD`, `CASH`).
- El pago queda **retenido (escrow)** hasta que el cliente confirma; en cancelación/disputa se reembolsa total o parcial. Efectivo = `CASH_ON_DELIVERY` (sin custodia).
- `POST /payments/webhooks`: la pasarela notifica `{reference, status: APPROVED|DECLINED}` firmado con **HMAC-SHA256** en `x-signature` (`PAYMENT_WEBHOOK_SECRET`). Es idempotente. Con `PAYMENT_AUTO_APPROVE=true` (por defecto) un simulador llama internamente al mismo manejador.
- Suscripciones: `GET /subscriptions/plans`, `GET /subscriptions/me`, `POST /subscriptions {plan, paymentMethod}`, `PUT /subscriptions/me`, `DELETE /subscriptions/me` (sigue activo hasta fin del periodo), `GET /subscriptions/invoices`. Renovación automática cada 30 días.
- Comisión transaccional **apagada** por defecto (configurable en `/admin/config`).

### M09–M13 · Reseñas, notificaciones, repuestos, cuenta
- `POST /reviews/:id/reply` (una respuesta por reseña).
- `GET /notifications`, `POST /notifications/read-all`, `PATCH /notifications/:id/read`, `GET/PUT /notifications/preferences` (push, correo, WhatsApp con opt-in).
- Repuestos: `GET /supplier/products` (precio con descuento del plan: Pro 10 %, Premium 15 %), `POST /supplier/orders` (precios y stock se calculan en el servidor; envío gratis desde $200.000), `GET /supplier/orders`. Proveedor: `POST/PUT/DELETE /supplier/products`, `PATCH /supplier/orders/:id/status`.
- Cliente: `/client/addresses`, `/client/equipments`, `/client/warranties`, `/client/payment-methods` (solo tokens de pasarela; se rechaza el número de tarjeta), `/client/favorites/:technicianId`.
- Disputas y reportes: `GET /disputes`, `POST /disputes/:id/comments`, `POST /reports`.

### M14 · Administración (HA-01…05, HI-08)
`GET /admin/verifications[?status]`, `GET /admin/verifications/:id/documents/:docId`, `POST /admin/verifications/:id {status, note}` · `GET /admin/disputes[/:id]`, `POST /admin/disputes/:id/resolve {decision: REFUND_FULL|REFUND_PARTIAL|RELEASE, amount?}` · `GET /admin/reviews`, `POST /admin/reviews/:id/hide|restore` · `GET /admin/reports`, `POST /admin/reports/:id/resolve` · `GET/PUT /admin/config` (planes, categorías, comisiones, envío, matching, política de cancelación) · `POST/PUT /admin/countries` · `GET /admin/metrics?city&from&to[&format=csv]` · `GET /admin/audit`.

### Configuración pública por país (sección 11)
`GET /config/countries`, `GET /config/countries/:code` (idioma, moneda, métodos de pago, planes), `GET /config/categories`.

## ☁️ Despliegue (Docker / Render)

**Local con Docker**
```bash
docker build -t sr-robot-backend .
docker run -p 3000:10000 -e JWT_SECRET=algo_largo -e PAYMENT_WEBHOOK_SECRET=otro_secreto sr-robot-backend
# o: docker compose up --build   (API en http://localhost:3000)
curl http://localhost:3000/health
```

**Render**
1. Sube el repo a GitHub.
2. En Render: *New → Blueprint* y selecciona el repo (usa [render.yaml](./render.yaml)), o *New → Web Service* con runtime **Docker**.
3. Health check: `/health`. Render inyecta `PORT` (la app escucha en `0.0.0.0:$PORT`).
4. Variables: `JWT_SECRET` y `PAYMENT_WEBHOOK_SECRET` son **obligatorias** en producción (el blueprint las genera). Opcionales: `CORS_ORIGINS`, `ADMIN_EMAIL`/`ADMIN_PASSWORD`, `SEED_DATA`, `EXPOSE_OTP`.
5. WebSocket funciona por `wss://<servicio>.onrender.com/chat/{id}?token=...` y `/events?token=...`.

**Producción real**: `SEED_DATA=false`, `EXPOSE_OTP=false` y define `ADMIN_EMAIL`/`ADMIN_PASSWORD` para crear el administrador inicial.

**Limitaciones del despliegue actual**
- Los datos están en memoria: se pierden en cada reinicio/redeploy (y el plan free de Render duerme el servicio). Para persistir hace falta conectar una BD.
- Los archivos subidos (`/app/uploads`) están en disco efímero; en Render requieren un *Persistent Disk* (plan de pago) montado en `/app/uploads`.
- Con `EXPOSE_OTP=true` el OTP se devuelve en la respuesta (demo sin proveedor SMS/email).

## ⚠️ Alcance y pendientes

Cubierto: todo P0 y la mayor parte de P1 del PDF. **Simulado** o fuera de alcance de esta versión:
- Persistencia real (BD), pasarela/escrow con licencia, SMS/correo/push/WhatsApp reales y mapas (el back expone coordenadas y distancias).
- Textos traducidos por idioma (HI-01), formato de moneda por locale (HI-02), motor de impuestos y facturación electrónica (HI-05) y pasaporte digital de reparación (HI-09): solo existe la configuración de país y el idioma/país del usuario.
- Equipos de técnicos (HT-15) y observabilidad avanzada (HX-04): hay registro de auditoría y logs, no alertas ni trazas.
