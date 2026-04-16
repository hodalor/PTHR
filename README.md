# PTHR Frontend (Admin Web)

## Environment setup

1. Copy example env file:

```bash
cp .env.example .env
```

2. Set API base URL:

```env
REACT_APP_API_BASE_URL=https://pthr.onrender.com
```

The frontend reads this variable at build time. If this is missing, it falls back to `http://localhost:8000`.

## Local development

```bash
npm install
npm start
```

## Production build

```bash
npm run build
```

## Netlify deployment notes

- Build command: `npm run build`
- Publish directory: `build`
- Required env var: `REACT_APP_API_BASE_URL`
- After changing env vars on Netlify, trigger a new deploy so React rebuilds with the new API URL.

## Troubleshooting

- If login shows backend not connected, check:
  - backend URL is correct and reachable
  - backend has started and database is connected
  - Netlify env variable is exactly `REACT_APP_API_BASE_URL`

## Multi-tenant login

- Login now requires:
  - `Tenant ID`
  - `Username or Employee ID`
  - `Password`
- Use `master` tenant for platform super-admin access.
