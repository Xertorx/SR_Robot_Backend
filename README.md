# 🤖 Sr Robot - Backend API (Node.js + Express)

Servidor backend robusto, modular y escalable para **Sr Robot**, el marketplace de reparación de equipos y repuestos de tecnología. Desarrollado según la especificación de funcionalidades, historias de usuario (HC, HT, HA, HX, HI) y mapa de arquitectura del proyecto.

---

## 📐 Estructura del Proyecto

```
sr-robot-backend/
├── src/
│   ├── config/              # Configuración de variables de entorno y base de datos
│   ├── constants/           # Definición de roles, estados de orden y planes
│   ├── controllers/         # Lógica de controladores HTTP (req, res, next)
│   ├── middlewares/         # Autenticación JWT, RBAC, validaciones y errores
│   ├── models/              # Modelos de datos / entidades de dominio
│   ├── routes/              # Declaración de endpoints REST y enrutadores
│   ├── services/            # Lógica de negocio (Escrow, Estado de órdenes, Geo-búsqueda)
│   ├── utils/               # Utilidades (Cálculo Haversine, Loggers)
│   ├── app.js               # Inicialización de Express y middlewares globales
│   └── server.js            # Punto de entrada HTTP
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## 🚀 Módulos e Historias de Usuario Implementadas

| Módulo | Historias de Usuario Relevantes | Endpoints Clave |
|---|---|---|
| **M01: Identidad y Acceso** | HC-01, HT-01 | `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `POST /api/v1/auth/otp` |
| **M02: Directorio y Búsqueda** | HC-02, HC-03, HC-04, HC-05 | `GET /api/v1/technicians` (Filtros por `lat`, `lng`, `cat`, `home`, `verified`, `minRating`, `q`) |
| **M03: Perfil y Catálogo Técnico** | HT-01, HT-02, HT-03 | `POST/GET /api/v1/technicians/me/services`, `GET /api/v1/technicians/:id` |
| **M04: Cotizaciones** | HC-06, HC-07, HC-08, HT-04, HT-05, HT-06 | `POST /api/v1/quotes/requests`, `GET /api/v1/quotes/requests/:id/quotes`, `POST /api/v1/quotes` |
| **M05: Agenda y Citas** | HC-09, HT-07 | `GET /api/v1/technicians/:id/availability`, `POST /api/v1/appointments` |
| **M06: Órdenes y Seguimiento** | HC-11, HC-13, HT-07, HT-08 | `GET /api/v1/orders`, `POST /api/v1/orders/:id/transitions`, `POST /api/v1/orders/:id/confirm-receipt` |
| **M07: Mensajería / Chat** | HC-15, HT-09 | `GET/POST /api/v1/chat/conversations`, `POST /api/v1/chat/conversations/:id/messages` |
| **M08: Pagos, Escrow y Planes** | HC-10, HT-12, HT-14 | `POST /api/v1/payments/escrow`, `POST /api/v1/subscriptions`, `GET /api/v1/technicians/me/wallet` |
| **M09: Reseñas y Reputación** | HC-14, HT-10 | `POST /api/v1/reviews`, `POST /api/v1/reviews/:id/reply` (Reseñas auditadas) |
| **M10: Notificaciones** | HC-16, HX-03, HI-07 | Integrado en eventos de orden (vía logger/simulador de WhatsApp & Push) |
| **M11: Marketplace Repuestos** | HT-13 | `GET /api/v1/supplier/products`, `POST /api/v1/supplier/orders` |
| **M12: Panel y Analítica** | HT-11 | `GET /api/v1/technicians/me/analytics` |
| **M13: Cuenta del Cliente** | HC-18, HC-19 | `GET/POST /api/v1/client/equipments`, `GET/POST /api/v1/client/addresses` |
| **M14: Administración** | HA-01, HA-02, HA-03, HA-04, HA-05 | `GET/POST /api/v1/admin/verifications`, `GET/POST /api/v1/admin/disputes` |

---

## 🔄 Máquina de Estados de la Orden (Contrato Front-Back)

1. `SOLICITADO`: Cita o cotización aceptada. Pago ingresa en custodia (Escrow).
2. `DIAGNOSTICO`: El técnico inspecciona el equipo y confirma/ajusta la cotización.
3. `EN_REPARACION`: Trabajo en proceso tras aprobación.
4. `LISTO`: Reparación terminada. Se notifica al cliente para entrega/recogida.
5. `ENTREGADO`: El cliente confirma la recepción. El pago se libera al técnico y se activa la garantía.
6. `CANCELADA / DISPUTA`: Gestión de reembolso o resolución por administrador (`HA-03`).

---

## 🛠️ Guía de Instalación y Ejecución

1. **Instalar dependencias:**
   ```bash
   npm install
   ```

2. **Configurar variables de entorno:**
   ```bash
   cp .env.example .env
   ```

3. **Iniciar en modo desarrollo (nodemon):**
   ```bash
   npm run dev
   ```

4. **Probar el Healthcheck:**
   `GET http://localhost:3000/health`
