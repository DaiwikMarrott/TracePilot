# TracePilot

Claude prompt evaluation and reliability console.

## Quick start

Requires Node.js 22.12 or newer (`.nvmrc` pins 24).

```sh
nvm use          # optional
npm install
cp .env.example .env   # optional; mock mode needs no API key
npm run dev      # API on :8787, interface on http://localhost:5173
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the API server and the Vite interface together |
| `npm run typecheck` | Type-check server and client |
| `npm run lint` | ESLint |
| `npm test` | Vitest (Node project for the server, jsdom project for components) |
