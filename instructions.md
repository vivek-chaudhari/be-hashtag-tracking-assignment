# SARAL Hashtag Tracking Assignment

## Overview

This project implements an end-to-end hashtag media ingestion pipeline using the Meta Graph API, PostgreSQL, AWS SQS, and Amazon S3.

The system is designed around two decoupled processing stages:

1. Fetch hashtag media from the Meta Graph API and persist media metadata in PostgreSQL.
2. Download media assets and upload them to Amazon S3 asynchronously.

This separation prevents media download/upload latency from blocking the Meta ingestion workflow and allows each stage to scale and retry independently.

---

## Architecture

```text
                         ┌─────────────────────┐
                         │ EventBridge Scheduler│
                         │     Every 3 hours   │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │ matcha-hashtag-sync │
                         │        SQS          │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │ Hashtag Sync Worker │
                         │                     │
                         │ • Meta API          │
                         │ • Pagination        │
                         │ • Up to 500 media   │
                         │ • Idempotency       │
                         └──────┬─────────┬────┘
                                │         │
                        metadata│         │upload jobs
                                ▼         ▼
                    ┌───────────────┐  ┌─────────────────────┐
                    │  PostgreSQL   │  │ matcha-media-upload │
                    │               │  │        SQS          │
                    │ • Hashtags    │  └──────────┬──────────┘
                    │ • Media       │             │
                    │ • Sync Runs   │             ▼
                    └───────────────┘  ┌─────────────────────┐
                                       │ Media Upload Worker │
                                       │                     │
                                       │ • Download media    │
                                       │ • Upload to S3      │
                                       └──────────┬──────────┘
                                                  │
                                                  ▼
                                       ┌─────────────────────┐
                                       │      Amazon S3      │
                                       │    Media Assets     │
                                       └─────────────────────┘
```

### Main components

| Component               | Responsibility                                         |
| ----------------------- | ------------------------------------------------------ |
| Express API             | HTTP endpoints and health checks                       |
| Hashtag Sync Worker     | Consumes hashtag synchronization jobs                  |
| Media Fetcher           | Handles Meta API pagination                            |
| Media Ingestion Service | Persists media metadata and sync results               |
| Media Upload Worker     | Consumes media upload jobs                             |
| PostgreSQL              | Stores hashtags, media metadata, and sync runs         |
| SQS                     | Decouples asynchronous processing and provides retries |
| S3                      | Stores downloaded media assets                         |
| Meta Graph API          | Provides Instagram hashtag and media data              |

---

# Technology Stack

- **Runtime:** Node.js 20+
- **Language:** TypeScript
- **API:** Express
- **ORM:** Drizzle ORM
- **Database:** PostgreSQL
- **Queue:** AWS SQS
- **Object Storage:** Amazon S3
- **External API:** Meta Graph API
- **Testing:** Jest

# Prerequisites

- **Node.js:** v20.x or higher
- **PostgreSQL:** v14 or higher, running locally or in the cloud
- **AWS Account:** Access to:
  - SQS queue: `matcha-hashtag-sync`
  - SQS queue: `matcha-media-upload`
  - S3 bucket: `saral-hashtag-media`
- **Meta Developer Account:** A valid Instagram/Meta Graph API access token and the permissions required by the implemented API integration

> **Security:** Never commit AWS credentials, Meta access tokens, or other secrets to source control. Use environment variables locally and IAM roles or another secure credential mechanism in deployed environments.

---

# Installation & Database Setup

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment variables

Create a `.env` file in the project root using the variables documented in the **Environment Variables** section below.

Do not commit `.env` to source control.

## 3. Apply the database schema

For local development, the Drizzle schema can be pushed directly to PostgreSQL:

```bash
npm run db:push
```

Alternatively, generate and apply migrations:

```bash
npm run db:generate
npm run db:migrate
```

---

# Running the Services Locally

The application has one HTTP server and two independent background workers.

## 1. Express API Server

Starts the HTTP server on port `5000` with hot reloading:

```bash
npm run dev
```

## 2. Hashtag Sync Worker

Starts the long-polling SQS worker that consumes hashtag synchronization messages from:

```text
matcha-hashtag-sync
```

Run:

```bash
npm run worker:hashtag-sync
```

The worker:

1. Receives a hashtag sync message.
2. Initializes/resolves the hashtag.
3. Fetches recent or top media from Meta.
4. Persists media metadata to PostgreSQL.
5. Publishes media upload jobs to the media-upload SQS queue.

## 3. Media Upload Worker

Starts the long-polling SQS worker that consumes media upload jobs from:

```text
matcha-media-upload
```

Run:

```bash
npm run worker:media-upload
```

The worker:

1. Receives a media upload job.
2. Loads the media record from PostgreSQL.
3. Downloads the media asset.
4. Uploads the asset to S3.
5. Updates the media storage state in PostgreSQL.
6. Deletes the SQS message only after successful processing.

---

# Environment Variables

| Variable                  | Description                               | Example                                                                 |
| ------------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| `PORT`                    | Express application port                  | `5000`                                                                  |
| `APP_ENV`                 | Application environment                   | `development`                                                           |
| `DATABASE_URL`            | PostgreSQL connection string              | `postgresql://postgres:postgres@localhost:5432/hashtag_tracker`         |
| `AWS_REGION`              | AWS region used by SQS and S3             | `ap-south-1`                                                            |
| `AWS_ACCESS_KEY_ID`       | AWS IAM access key for local development  | `<your-aws-access-key>`                                                 |
| `AWS_SECRET_ACCESS_KEY`   | AWS IAM secret key for local development  | `<your-aws-secret-key>`                                                 |
| `S3_BUCKET_NAME`          | Target S3 bucket                          | `saral-hashtag-media`                                                   |
| `SQS_QUEUE_URL`           | Hashtag sync SQS queue URL                | `https://sqs.ap-south-1.amazonaws.com/<account-id>/matcha-hashtag-sync` |
| `MEDIA_UPLOAD_QUEUE_URL`  | Media upload SQS queue URL                | `https://sqs.ap-south-1.amazonaws.com/<account-id>/matcha-media-upload` |
| `META_ACCESS_TOKEN`       | Meta Graph API access token               | `<your-meta-access-token>`                                              |
| `META_USER_ID`            | Meta / Instagram Business Account user ID | `<your-meta-user-id>`                                                   |
| `META_GRAPH_API_VERSION`  | Meta Graph API version                    | `v24.0`                                                                 |
| `META_GRAPH_API_BASE_URL` | Meta Graph API base URL                   | `https://graph.facebook.com`                                            |

> **Important:** The example values above are placeholders. Do not use real credentials in documentation or commit them to the repository.

Sensitive credentials such as access tokens and secret keys are redacted from application logs.

---

# API Endpoints

## `GET /api/hashtags`

Returns paginated media records ordered by creation time in descending order.

An equivalent route may be available as:

```text
GET /hashtags
```

### Query parameters

| Parameter | Default | Maximum | Description                |
| --------- | ------: | ------: | -------------------------- |
| `page`    |     `1` |       — | Page number                |
| `limit`   |    `20` |   `100` | Number of records per page |

Example:

```text
GET /api/hashtags?page=1&limit=20
```

```text
Api Response
{
  "message": "Hashtag(s) fetched successfully",
  "result": {
    "data": [ ... ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 125,
      "totalPages": 7
    }
  },
  "isError": false
}
```

---

# SQS Message Flow

## Hashtag synchronization

A hashtag synchronization message is published to:

```text
matcha-hashtag-sync
```

Example:

```json
{
  "type": "SYNC_RECENT_HASHTAG_MEDIA",
  "hashtag": "matcha"
}
```

The hashtag sync worker processes the message and persists the fetched media metadata.

---

## Media upload

After media metadata has been stored, an upload job is published to:

```text
matcha-media-upload
```

Expected message:

```json
{
  "type": "UPLOAD_MEDIA",
  "mediaId": "<database-media-uuid>"
}
```

The media upload worker processes this message independently.

---

# SQS Retry & DLQ Behaviour

Messages are deleted from SQS **only after successful processing**.

If processing fails:

1. The message is not deleted.
2. The message becomes visible again after the configured visibility timeout.
3. SQS retries delivery.
4. After the configured `maxReceiveCount` is exceeded, SQS moves the message to the configured dead-letter queue (DLQ).

This prevents a transient Meta API, network, database, or S3 failure from permanently losing a job.

---

# Storage Lifecycle

Media records use storage states to make upload processing observable and idempotent.

```text
PENDING
   │
   ▼
UPLOADING
   │
   ├──────────────► COMPLETED
   │
   └──────────────► FAILED
```

If a message is delivered more than once, the upload service checks the current storage state before performing unnecessary work.

---

# S3 Object Naming

Media objects use a deterministic key based on the database media UUID:

```text
media/<mediaId>.<extension>
```

Example:

```text
media/550e8400-e29b-41d4-a716-446655440000.jpg
```

This provides:

- Deterministic object names
- Collision avoidance
- Idempotent processing
- No dependency on the original media filename

---

# Testing & Verification

## Run automated tests

```bash
npm test
```

## Type checking

```bash
npm run typecheck
```

## Linting

```bash
npm run lint
```

The project should pass type checking and linting before submission.

---

# Design Trade-offs

## 1. Two-stage decoupled SQS architecture

### Trade-off

Meta ingestion and media downloading/S3 uploading are separated into two SQS-backed processing stages:

```text
Meta API
   ↓
Hashtag Sync Worker
   ↓
PostgreSQL
   ↓
Media Upload SQS
   ↓
Media Upload Worker
   ↓
S3
```

### Benefit

A slow media download or S3 upload does not block Meta pagination or hashtag ingestion.

The stages can also be scaled and retried independently.

---

## 2. Meta Graph API pagination and throttling

### Trade-off

The Meta hashtag media endpoints can reject requests when the requested data volume becomes too large.

During live integration testing, larger field sets/page sizes produced:

```text
Please reduce the amount of data you're asking for
```

### Mitigation

The implementation uses a conservative page size and a maximum collection limit per synchronization run.

This reduces the amount of data requested per API call while still allowing pagination.

---

## 3. In-memory batch deduplication

### Trade-off

The same `meta_media_id` may appear more than once in a fetched batch.

### Mitigation

Media items are deduplicated in memory before insertion.

PostgreSQL also enforces uniqueness on `meta_media_id`, with conflict handling during insertion.

This provides protection at both the application and database layers.

---

## 4. Deterministic S3 key structure

### Trade-off

S3 object keys are based on the application's media UUID rather than the source media filename.

### Benefit

This provides deterministic, collision-resistant object names and makes repeated processing idempotent.

---

## 5. Idempotent S3 upload processing

Before downloading and uploading a media asset, the service checks whether the media record is already marked as:

```text
COMPLETED
```

If it is already completed, duplicate SQS deliveries do not result in unnecessary S3 operations.

---

## 6. SQS deletion and failure semantics

Messages are deleted only after successful processing.

This gives the system at-least-once processing semantics and allows failed jobs to be retried automatically.

Persistent failures are eventually routed to the configured DLQ according to the queue's redrive policy.

---

# AI-Assisted Development (ai-usage)

AI coding tools were used as development assistants during the implementation.

### Tools used

- Antigravity AI / Gemini 3.7 Flash & Pro
- Claude Sonnet 4.6

### AI assistance included

- Architecture and service scaffolding
- AWS SQS service abstractions
- AWS S3 storage service abstractions
- Meta Graph API client scaffolding
- Background worker scaffolding
- Pagination logic
- Initial automated test generation

### Manually reviewed and validated

The following areas were specifically reviewed and tested against the actual implementation/environment:

- Live Meta Graph API integration
- Meta API pagination behaviour
- Meta API request-size/throttling behaviour
- AWS SQS integration
- SQS visibility timeout and retry behaviour
- DLQ behaviour
- S3 upload lifecycle
- PostgreSQL constraints and conflict handling
- Media storage state transitions
- Idempotent processing
- End-to-end worker execution

The live Meta API behaviour was tested and the implementation was adjusted based on the actual API response behaviour rather than relying only on generated code.

---

# Local Development Summary

Start the three processes in separate terminals:

### Terminal 1 — API

```bash
npm run dev
```

### Terminal 2 — Hashtag Sync Worker

```bash
npm run worker:hashtag-sync
```

### Terminal 3 — Media Upload Worker

```bash
npm run worker:media-upload
```

The complete flow is then:

```text
API / SQS Trigger
       ↓
Hashtag Sync Worker
       ↓
Meta Graph API
       ↓
PostgreSQL
       ↓
Media Upload SQS
       ↓
Media Upload Worker
       ↓
S3
       ↓
GET /api/hashtags
```
