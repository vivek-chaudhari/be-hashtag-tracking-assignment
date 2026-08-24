# setup

### Prerequisites

- **Node.js**: v20.x or higher
- **PostgreSQL**: v14 or higher running locally or in the cloud
- **AWS Account**: SQS queues (`matcha-hashtag-sync`, `matcha-media-upload`) and S3 bucket (`saral-hashtag-media`)
- **Meta Developer Account**: Instagram Graph API user access token with hashtag search permissions (`instagram_basic`, `instagram_manage_insights`, etc.)

---

### Installation & Database Setup

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Configure environment variables:**
   Copy the example configuration or edit `.env` in the project root (see `# vars` section below).

3. **Apply database schema:**
   Push the Drizzle schema directly to PostgreSQL:
   ```bash
   npm run db:push
   ```
   _(Alternatively, generate and run migrations via `npm run db:generate` and `npm run db:migrate`)_.

---

### Running the Services Locally

#### 1. Express API Server

Starts the HTTP server on port 3000 (with hot reloading):

```bash
npm run dev
```

#### 2. Hashtag Sync Worker

Starts the long-polling SQS worker consuming hashtag sync trigger messages from `matcha-hashtag-sync`:

```bash
npm run worker:hashtag-sync
```

#### 3. Media Upload Worker

Starts the long-polling SQS worker consuming media asset upload jobs from `matcha-media-upload`:

```bash
npm run worker:media-upload
```

---

### Testing & Verification

- **Run all automated unit & integration tests:**
  ```bash
  npm test
  ```
- **Type checking:**
  ```bash
  npm run typecheck
  ```
- **Linting & code style:**
  ```bash
  npm run lint
  ```

---

### API Endpoints

- **`GET /api/hashtags`** (or `GET /hashtags`):
  Retrieve paginated media records ordered by `createdAt` in descending order.
  - Query params: `page` (default 1), `limit` (default 20, max 100).
- **`GET /api/health`**:
  Basic health check endpoint.
- **`POST /api/internal/queue/sync-recent`**:
  Manual test producer to enqueue a `SYNC_RECENT_HASHTAG_MEDIA` message to the SQS hashtag sync queue.

---

# vars

| Variable                  | Description                                                   | Example / Default                                                       |
| ------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `PORT`                    | Port for the Express application                              | `3000`                                                                  |
| `APP_ENV`                 | Application environment (`development`, `test`, `production`) | `development`                                                           |
| `DATABASE_URL`            | PostgreSQL connection string                                  | `postgresql://postgres:postgres@localhost:5432/hashtag_tracker`         |
| `AWS_REGION`              | AWS Region for SQS and S3 clients                             | `ap-south-1`                                                            |
| `AWS_ACCESS_KEY_ID`       | AWS IAM Access Key ID                                         | `AKIA...`                                                               |
| `AWS_SECRET_ACCESS_KEY`   | AWS IAM Secret Access Key                                     | `wJalrXUtnFEMI/K7MDENG/bPxRfiCY...`                                     |
| `S3_BUCKET_NAME`          | Target S3 bucket name for media asset storage                 | `saral-hashtag-media`                                                   |
| `SQS_QUEUE_URL`           | URL of the SQS queue for hashtag sync triggers                | `https://sqs.ap-south-1.amazonaws.com/<account-id>/matcha-hashtag-sync` |
| `MEDIA_UPLOAD_QUEUE_URL`  | URL of the SQS queue for media asset uploads                  | `https://sqs.ap-south-1.amazonaws.com/<account-id>/matcha-media-upload` |
| `META_ACCESS_TOKEN`       | Meta Graph API user access token                              | `EAA...`                                                                |
| `META_USER_ID`            | Meta / Instagram Business Account User ID                     | `17841480695597364`                                                     |
| `META_GRAPH_API_VERSION`  | Meta Graph API version                                        | `v24.0`                                                                 |
| `META_GRAPH_API_BASE_URL` | Base URL for the Meta Graph API                               | `https://graph.facebook.com`                                            |

> [!NOTE]
> Sensitive credentials (access tokens, secret keys, signed URLs) are automatically redacted in application logs.

---

# tradeoffs

1. **Two-Stage Decoupled SQS Architecture**:
   - **Tradeoff**: Ingestion from Meta Graph API into PostgreSQL is separated from media downloading and S3 uploading via two distinct SQS queues (`matcha-hashtag-sync` and `matcha-media-upload`).
   - **Benefit**: Ensures fast and reliable hashtag sync runs without stalling Meta pagination if individual media downloads or S3 uploads experience network latency.

2. **Meta Graph API Hashtag Pagination Throttling**:
   - **Tradeoff**: Meta Graph API hashtag endpoints (`/top_media`, `/recent_media`) enforce strict cursor depth limits and memory budgets. Querying large page sizes with all metrics can trigger HTTP 500 error code 1 (_"Please reduce the amount of data you're asking for"_).
   - **Mitigation**: Configured default page size to 5 while maintaining pagination loop detection and a 500-item total collection cap per sync.

3. **In-Memory Batch Deduplication Prior to PostgreSQL Insertion**:
   - **Tradeoff**: Single-batch `INSERT INTO media ... ON CONFLICT (meta_media_id) DO NOTHING` fails in PostgreSQL if the incoming batch itself contains duplicate `meta_media_id` items.
   - **Mitigation**: Media items are deduplicated in-memory before building the insert query, ensuring atomic, conflict-free single-query batch insertions.

4. **Deterministic S3 Key Structure**:
   - **Tradeoff**: S3 storage keys follow `media/<mediaId>.<ext>` using the database UUID and MIME Content-Type header.
   - **Benefit**: Eliminates name collisions, maintains URL privacy, and enables idempotent re-runs without duplicate object creation.

5. **Idempotent S3 Upload Processing**:
   - **Tradeoff**: Before downloading and uploading assets, `MediaUploadService` verifies whether `storageStatus === 'COMPLETED'`.
   - **Benefit**: Duplicate SQS message deliveries do not trigger redundant downloads or S3 writes.

6. **SQS Deletion Semantics & Dead-Letter Handling**:
   - **Tradeoff**: SQS messages are deleted strictly upon successful completion.
   - **Benefit**: Unexpected network, database, or S3 errors cause the message to remain in the queue; after visibility timeout expiration, AWS SQS automatically retries and transfers persistently failing messages to the dead-letter queue (DLQ) without poison message loops.
