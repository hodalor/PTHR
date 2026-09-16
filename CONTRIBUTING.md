# Contributing

## Development setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment variables:

```bash
cp .env.example .env
```

3. Start the app:

```bash
npm start
```

## Branch and PR expectations

- Use focused branches such as `feature/...`, `fix/...`, `refactor/...`, or `docs/...`
- Keep each PR scoped to one concern where practical
- Include tests with behavior changes and refactors that affect business logic
- Update documentation when architecture, setup, or workflows change

Small commit series are strongly preferred over one large mixed change.

## Required checks

Before opening or updating a PR, run:

```bash
npm run lint
npm test -- --coverage --watchAll=false
npm run build
```

The CI workflow runs the same checks and also runs `npm audit --audit-level=high`.

## Commit expectations

- Keep commit messages focused and descriptive
- Prefer commit series like:
  - `ci: ...`
  - `test: ...`
  - `refactor: ...`
  - `docs: ...`
  - `security: ...`
- Avoid giant commits that mix refactors, tests, docs, and unrelated bug fixes together

## Architecture notes

- `src/App.js` is still the main application controller in the legacy frontend
- `src/pages/` holds major screens
- `src/modules/` contains domain-specific modules and adapter logic
- `src/modules/payroll/usePayrollAdapter.js` is the current reference example of the adapter pattern
- `src/config/moduleUiData.js` holds module metadata used by the UI shell
- `src/utils/` contains reusable shared helpers such as attendance rules, warm cache, file upload, CSV, and search utilities

When adding new functionality, prefer extending an existing domain area instead of growing `App.js` further.

## How to add a new feature

1. Identify the domain first: attendance, payroll, loans, leave, tenants, settings, or shared utilities
2. Put reusable business logic in `src/modules/` or `src/utils/`
3. Keep raw API calls out of presentational components where possible
4. Add or update tests in the same PR
5. Update README or inline documentation when the architecture meaningfully changes

## How to add tests

- Use Jest and React Testing Library
- Prefer meaningful assertions over smoke tests
- For legacy areas, add coverage around business rules before broad UI snapshots
- Good targets include:
  - payroll calculations
  - attendance rule behavior
  - validation helpers
  - extracted utilities
  - critical page loading and error states

## CI requirements

- CI must stay green for lint, test, and build
- Coverage must not drop below the current baseline thresholds
- High or critical dependency issues are intentionally visible through CI and should not be hidden just to get a passing pipeline
