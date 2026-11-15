# Despacho jurídico 33 grados (D.J. 33G) — Proyecto web

Aplicación web para expedir **actas de nacimiento, matrimonio y defunción**.
Un solo servicio (Node.js + Express + SQLite en archivo) que sirve el
frontend y la API. Sin datos sembrados: la producción empieza vacía.

## Qué hace

- Catálogo de actas: Nacimiento **$250 MXN**, Matrimonio **$350 MXN**,
  Defunción **$250 MXN** (precios editables por el administrador).
- Solicitud en línea por acta: nombre del solicitante, contacto
  (teléfono/email), y datos para localizar el registro (nombre completo del
  registrado, fecha del acto, municipio, estado y CURP opcional). Al enviar se
  genera un **folio** y un **código secreto** de acceso.
- **Mis trámites**: consulta con folio + código secreto.
- **Administrador**: el primer acceso crea un PIN (la sesión dura 30 días en
  ese dispositivo). Solo el admin ve todos los trámites, confirma pagos
  manualmente, cambia el estado de los trámites y edita precios. Los
  invitados solo ven lo público y sus propios trámites con su código.
- **Pagos con Mercado Pago**: con las claves en variables de entorno se crea
  la preferencia de pago oficial. Sin claves, el trámite queda
  "pendiente de pago" y el admin lo confirma manualmente.

## Correrlo localmente

Requisitos: **Node.js 22.5 o mayor** (usa el módulo `node:sqlite` incluido
en Node, sin compilación nativa).

```bash
cd proyecto-web-dj33g
npm install
cp .env.example .env   # opcional: llena MP_PUBLIC_KEY y MP_ACCESS_TOKEN
npm start
```

Abre http://localhost:3000

La base de datos se crea sola en `data/dj33g.db` al arrancar.

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `PORT` | No (por defecto 3000) | Puerto del servidor |
| `DB_PATH` | No (por defecto `./data/dj33g.db`) | Ruta del archivo SQLite |
| `MP_PUBLIC_KEY` | No | Public Key de Mercado Pago |
| `MP_ACCESS_TOKEN` | No | Access Token de Mercado Pago |

Sin `MP_ACCESS_TOKEN` no se cobra en línea: los trámites quedan pendientes
y el administrador los confirma a mano. Nunca pongas credenciales reales en
el código: solo en variables de entorno.

## Desplegarlo en Render (gratis) y obtener la dirección https

1. Sube este proyecto a un repositorio de GitHub (privado o público).
2. En [Render](https://render.com) crea una cuenta gratuita y elige
   **New → Web Service** → conecta tu repositorio.
3. Render detecta el archivo `render.yaml` (Blueprint) con el plan **free**,
   Node 22, `npm install` para compilar y `npm start` para arrancar.
   También puedes crear el servicio a mano: Environment **Node**, Build
   Command `npm install`, Start Command `npm start`.
4. En **Environment** del servicio agrega las variables (sin valores reales
   en el repositorio):
   - `MP_PUBLIC_KEY` = tu Public Key de Mercado Pago
   - `MP_ACCESS_TOKEN` = tu Access Token de Mercado Pago
5. Despliega. Render te dará una dirección pública, por ejemplo:
   `https://dj33g.onrender.com`
6. Esa es la dirección que va en el proyecto Android (`APP_URL` en
   `MainActivity.kt`) y la que compartes por WhatsApp.

> En el plan gratuito de Render el servicio se duerme tras unos minutos sin
> uso y tarda unos segundos en despertar al primer visitante, y el disco es
> efímero: la base `data/dj33g.db` se reinicia si el servicio se redepliega.
> Para datos permanentes, agrega un disco persistente en Render (plan de
> pago) o una base externa y ajusta `DB_PATH`.

## Estructura

```
proyecto-web-dj33g/
├── server.js          # API + servidor del frontend
├── package.json
├── render.yaml        # Despliegue en Render (plan free, Node 22)
├── .env.example
├── public/
│   ├── index.html     # Página principal (hero, actas, trámites, admin)
│   ├── styles.css     # Azul marino + dorado
│   ├── app.js         # Lógica del frontend
│   └── logo.png       # Logo del despacho (fondo transparente)
└── data/
    └── dj33g.db       # Se crea al arrancar (no se sube al repositorio)
```

## API (resumen)

- `GET /api/catalog` — actas y precios.
- `POST /api/requests` — crear solicitud (devuelve folio y código secreto).
- `GET /api/requests/:folio?code=XXXX` — consultar un trámite.
- `POST /api/requests/:folio/pay` — crear preferencia de Mercado Pago.
- `GET /api/admin/status` — ¿ya existe PIN?
- `POST /api/admin/setup` — crear el PIN (solo la primera vez).
- `POST /api/admin/login` — entrar (sesión de 30 días).
- `GET /api/admin/requests` — todos los trámites (admin).
- `POST /api/admin/requests/:folio/confirm-payment` — confirmar pago manual.
- `POST /api/admin/requests/:folio/status` — cambiar estado del trámite.
- `PUT /api/admin/prices` — editar precios.
