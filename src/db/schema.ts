import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql, relations } from 'drizzle-orm';

export type StorageStatus = 'PENDING' | 'UPLOADING' | 'COMPLETED' | 'FAILED';
export type SyncType = 'TOP' | 'RECENT';
export type SyncStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';

// ============================================================
// 1. Hashtags Table
// ============================================================
export const hashtags = pgTable('hashtags', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull().unique('uq_hashtags_name'),
  metaHashtagId: varchar('meta_hashtag_id', { length: 255 })
    .notNull()
    .unique('uq_hashtags_meta_hashtag_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

// ============================================================
// 2. Media Table
// ============================================================
export const media = pgTable(
  'media',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    hashtagId: uuid('hashtag_id')
      .notNull()
      .references(() => hashtags.id, { onDelete: 'cascade' }),
    metaMediaId: varchar('meta_media_id', { length: 255 })
      .notNull()
      .unique('uq_media_meta_media_id'),
    mediaType: varchar('media_type', { length: 50 }).notNull(),
    caption: text('caption'),
    mediaUrl: text('media_url'),
    permalink: text('permalink'),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    likeCount: integer('like_count'),
    commentsCount: integer('comments_count'),
    storageKey: text('storage_key'),
    storageStatus: varchar('storage_status', { length: 30 })
      .$type<StorageStatus>()
      .default('PENDING')
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    idxMediaHashtagPublishedAt: index('idx_media_hashtag_published_at').on(
      table.hashtagId,
      table.publishedAt.desc(),
    ),
    idxMediaCreatedAt: index('idx_media_created_at').on(table.createdAt.desc()),
    idxMediaStorageStatus: index('idx_media_storage_status').on(table.storageStatus),
    chkMediaStorageStatus: check(
      'chk_media_storage_status',
      sql`${table.storageStatus} IN ('PENDING', 'UPLOADING', 'COMPLETED', 'FAILED')`,
    ),
  }),
);

// ============================================================
// 3. Sync Runs Table
// ============================================================
export const syncRuns = pgTable(
  'sync_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    hashtagId: uuid('hashtag_id')
      .notNull()
      .references(() => hashtags.id, { onDelete: 'cascade' }),
    syncType: varchar('sync_type', { length: 30 }).$type<SyncType>().notNull(),
    status: varchar('status', { length: 30 }).$type<SyncStatus>().default('RUNNING').notNull(),
    itemsFetched: integer('items_fetched').default(0).notNull(),
    itemsCreated: integer('items_created').default(0).notNull(),
    itemsSkipped: integer('items_skipped').default(0).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    error: text('error'),
  },
  (table) => ({
    idxSyncRunsHashtagStartedAt: index('idx_sync_runs_hashtag_started_at').on(
      table.hashtagId,
      table.startedAt.desc(),
    ),
    chkSyncType: check('chk_sync_type', sql`${table.syncType} IN ('TOP', 'RECENT')`),
    chkSyncStatus: check(
      'chk_sync_status',
      sql`${table.status} IN ('RUNNING', 'COMPLETED', 'FAILED')`,
    ),
  }),
);

// ============================================================
// Relations
// ============================================================
export const hashtagsRelations = relations(hashtags, ({ many }) => ({
  media: many(media),
  syncRuns: many(syncRuns),
}));

export const mediaRelations = relations(media, ({ one }) => ({
  hashtag: one(hashtags, {
    fields: [media.hashtagId],
    references: [hashtags.id],
  }),
}));

export const syncRunsRelations = relations(syncRuns, ({ one }) => ({
  hashtag: one(hashtags, {
    fields: [syncRuns.hashtagId],
    references: [hashtags.id],
  }),
}));

// ============================================================
// Inferred TypeScript Models
// ============================================================
export type Hashtag = typeof hashtags.$inferSelect;
export type NewHashtag = typeof hashtags.$inferInsert;

export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;

export type SyncRun = typeof syncRuns.$inferSelect;
export type NewSyncRun = typeof syncRuns.$inferInsert;
