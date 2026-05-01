# Cue Backend

Node.js/Express backend for the Cue Chrome extension.

## Setup

1. Clone this repo
2. `npm install`
3. Copy `.env.example` to `.env` and fill in your keys
4. `npm start`

## Environment Variables

See `.env.example` for all required variables.

## Endpoints

- `GET /health` — health check
- `GET /api/user/status` — get user tier and daily usage
- `POST /api/analyze` — analyze and improve a prompt
- `POST /api/extract-file` — extract context from uploaded file
- `POST /api/create-checkout` — create Stripe checkout session
- `POST /api/webhook` — Stripe webhook handler

## Deploy to Railway

1. Push to GitHub
2. Connect repo in Railway
3. Add environment variables in Railway dashboard
4. Deploy
