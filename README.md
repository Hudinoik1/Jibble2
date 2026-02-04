# Jibble Daily Work Report

This app renders daily work reports for each person in your Jibble account. It asks for the
Jibble **API Key ID** and **API Key Secret**, then fetches people and time entries for the
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

## Notes

- If your Jibble region uses a different base URL, edit the Base API URL field.
- The app sends credentials using Basic Auth as `API Key ID:API Key Secret`.
- Reports group time entries by location/project/activity and calculate total and balance
  (default 8-hour shift).
