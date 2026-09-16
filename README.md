# PTHR Frontend (Admin Web)

## Environment setup

1. Copy the example env file:

```bash
cp .env.example .env
```

2. Update the values you need:

```env
NODE_ENV=development
PUBLIC_URL=
REACT_APP_API_BASE_URL=https://pthr.onrender.com
REACT_APP_GOOGLE_MAPS_TILE_KEY=your-google-maps-tile-key
```

The frontend reads `REACT_APP_*` values at build time. If `REACT_APP_API_BASE_URL` is missing, the app falls back to `http://localhost:8000` on localhost and the hosted API elsewhere.

## Local development

```bash
npm install
npm start
```

## Quality checks

```bash
npm run lint
npm test -- --coverage --watchAll=false
npm run build
npm audit --audit-level=high
```

CI runs the same checks on every push and pull request through [`.github/workflows/ci.yml`](file:///Users/macbook/Documents/projects/ReactJS/pthr/frontend/.github/workflows/ci.yml).

## Architecture

The frontend is still a legacy CRA application with a large [`src/App.js`](file:///Users/macbook/Documents/projects/ReactJS/pthr/frontend/src/App.js) acting as the main application controller. The current refactor direction is:

Application  
↓  
App controller / routing state  
↓  
Pages and presentational components  
↓  
Hooks and domain adapters  
↓  
Domain modules and utilities  
↓  
Backend API

### Current structure

- [`src/index.js`](file:///Users/macbook/Documents/projects/ReactJS/pthr/frontend/src/index.js) is the entry point. It renders `App` and wraps `window.fetch` so tenant and auth headers are applied consistently.
- [`src/App.js`](file:///Users/macbook/Documents/projects/ReactJS/pthr/frontend/src/App.js) still coordinates authentication state, module selection, much of the data fetching, and many page-level handlers.
- [`src/pages/`](file:///Users/macbook/Documents/projects/ReactJS/pthr/frontend/src/pages) contains major domain screens such as Dashboard, Attendance, Payroll, Loans, and Tenants.
- [`src/modules/`](file:///Users/macbook/Documents/projects/ReactJS/pthr/frontend/src/modules) contains domain-specific helpers and UI, including payroll logic and adapter hooks.
- [`src/modules/payroll/usePayrollAdapter.js`](file:///Users/macbook/Documents/projects/ReactJS/pthr/frontend/src/modules/payroll/usePayrollAdapter.js) is an example of the adapter pattern already used to bridge raw rows into payroll-specific UI behavior.
- [`src/config/moduleUiData.js`](file:///Users/macbook/Documents/projects/ReactJS/pthr/frontend/src/config/moduleUiData.js) defines module metadata used by navigation and module rendering.
- [`src/utils/`](file:///Users/macbook/Documents/projects/ReactJS/pthr/frontend/src/utils) now holds extracted shared logic such as:
  - [`attendanceRules.js`](file:///Users/macbook/Documents/projects/ReactJS/pthr/frontend/src/utils/attendanceRules.js)
  - [`fileUpload.js`](file:///Users/macbook/Documents/projects/ReactJS/pthr/frontend/src/utils/fileUpload.js)
  - [`warmCache.js`](file:///Users/macbook/Documents/projects/ReactJS/pthr/frontend/src/utils/warmCache.js)

### Routing

This application does not yet use a fully separated route tree. Routing is currently module/state-driven inside `App.js` through the active module state and page-specific rendering branches. That is one of the next decomposition targets.

### Services / API layer

The API layer is still transitional. Today:

- `index.js` injects auth and tenant headers into `fetch`
- `src/config/api.js` normalizes API base URLs
- many module/page fetches still live in `App.js`

The ongoing refactor goal is to move those fetches behind focused services and hooks without changing existing API contracts.

### Testing strategy

- Jest and React Testing Library run through `react-scripts test`
- coverage is generated on CI and locally
- global coverage thresholds are set from the current legacy baseline so coverage cannot silently fall backwards
- current targeted tests cover:
  - authentication-visible behavior in `App`
  - attendance rule normalization and lookup
  - payroll attendance deduction logic
  - file upload helpers
  - warm-cache helpers

## Dependency health

The frontend currently carries inherited `react-scripts` ecosystem vulnerabilities, and CI intentionally fails the audit job when high or critical issues are present. Direct unused dev dependencies were removed, but some remaining advisories are transitive to the current CRA toolchain and need a careful migration plan rather than a blind major upgrade.

Dependabot is configured in [`.github/dependabot.yml`](file:///Users/macbook/Documents/projects/ReactJS/pthr/frontend/.github/dependabot.yml) for weekly npm and GitHub Actions updates.

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

- Login requires:
  - `Tenant ID`
  - `Username or Employee ID`
  - `Password`
- Use `master` tenant for platform super-admin access.
