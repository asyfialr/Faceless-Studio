# Faceless Studio Backend

V1.0 backend foundation.

## Endpoints
- GET /api/health
- GET /api/capabilities

## Security
Keep all API keys, Google OAuth secrets, refresh tokens and future storage credentials in environment variables on the hosting provider. Never place them in the GitHub Pages frontend.

## Run locally
1. Copy .env.example to .env and configure values.
2. Install dependencies with npm install.
3. Start with npm start.

The next deployment step is to host this backend and point the dashboard to its public HTTPS URL.
