# SARAL Hashtag Tracking Assignment

End-to-end Instagram hashtag media ingestion pipeline built with Node.js, TypeScript, Express, Drizzle ORM, AWS SQS, and Amazon S3.

---

## Documentation

Full setup instructions, environment variables, API reference, architecture, and design trade-offs are documented in:

👉 **[instructions.md](./instructions.md)**

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in environment variables
cp .env.example .env

# 3. Push database schema
npm run db:push

# 4. Start the API server
npm run dev

# 5. Start the Hashtag Sync Worker (separate terminal)
npm run worker:hashtag-sync

# 6. Start the Media Upload Worker (separate terminal)
npm run worker:media-upload
```

---

## API

```
GET /api/hashtags?page=1&limit=20
```

---

## Tests

```bash
npm test          # run all tests
npm run typecheck # TypeScript type checking
npm run lint      # ESLint
```

---

## AI Usage

See [`ai-usage/README.md`](./ai-usage/README.md) for a summary of how AI tools were used during development, and [`ai-usage/chat-history.md`](./ai-usage/chat-history.md) for the full interaction log.
