/**
 * The Drizzle adapter the README's "Production stores" section shows. The README block
 * mirrors this file; the integration test runs it against a real SQLite database.
 */
import { and, eq, isNull, lte } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createOrmStore } from '../../src/store.js'

export const magicLinkTokens = sqliteTable('magic_link_tokens', {
  token: text('token').primaryKey(),
  email: text('email').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  consumedAt: integer('consumed_at', { mode: 'timestamp_ms' }),
})

export function createDrizzleMagicLinkStore(db: BetterSQLite3Database) {
  return createOrmStore({
    async insert(row) {
      await db.insert(magicLinkTokens).values(row)
    },
    async consumeAtomically(token, now) {
      // One UPDATE ... WHERE consumed_at IS NULL RETURNING: the database arbitrates the race.
      const rows = await db
        .update(magicLinkTokens)
        .set({ consumedAt: now })
        .where(and(eq(magicLinkTokens.token, token), isNull(magicLinkTokens.consumedAt)))
        .returning({ email: magicLinkTokens.email, expiresAt: magicLinkTokens.expiresAt })
      return rows[0] ?? null
    },
    async delete(token) {
      await db.delete(magicLinkTokens).where(eq(magicLinkTokens.token, token))
    },
    async deleteExpired(now) {
      const rows = await db
        .delete(magicLinkTokens)
        .where(lte(magicLinkTokens.expiresAt, now))
        .returning()
      return rows.length
    },
  })
}
