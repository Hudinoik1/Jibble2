# Jibble Daily Work Report

This app renders daily work reports for each person in your Jibble account. It asks for the
Jibble **Client ID** and **Client Secret**, then fetches people and time entries for the
selected date.

## Running locally

```bash
npm install
npm start
```

Visit `http://localhost:3000`.

## Render deployment

Create a new **Web Service** on Render, then use:

- **Build Command:** `npm install`
- **Start Command:** `npm start`

The service uses the `PORT` environment variable automatically.

## Connection redundancies

The backend intentionally tries multiple options to avoid API errors:

- Base URL candidates include `/v1`, `/v2`, `/api/v1`, and `/api/v2` variants.
- OAuth access token retrieval uses the Jibble identity endpoint and retries on transient failures.
- Requests respect a configurable timeout.

## Notes

- Use the **Client ID** and **Client Secret** from Jibble (OAuth client credentials flow).
- If your Jibble region uses a different base URL, edit the Base API URL field.
- Reports group time entries by location/project/activity and calculate total and balance
  (default 8-hour shift).
