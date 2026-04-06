# PTHR Backend

## Environment setup

1. Copy env file:

```bash
cp .env.example .env
```

2. Configure values:

```env
PORT=8000
MONGO_URI=mongodb+srv://username:password@cluster-url/db-name
MONGO_DB_NAME=hr
JWT_SECRET=change-this-in-production
```

## Run locally

```bash
npm install
npm run dev
```

## Render deployment

- Root directory: `backend`
- Build command: `npm run build`
- Start command: `npm run start`
- Environment variables:
  - `MONGO_URI`
  - `MONGO_DB_NAME`
  - `JWT_SECRET`
  - `PORT` is managed by Render

If Render shows `Cannot find module 'express'`, clear build cache and redeploy.
