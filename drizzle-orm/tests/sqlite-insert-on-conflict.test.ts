import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { sql } from '~/sql';
import { integer, sqliteTable, text } from '~/sqlite-core';
import { drizzle } from '~/sqlite-proxy';

const users = sqliteTable('users', {
	id: integer().primaryKey(),
	email: text().notNull(),
	deletedAt: integer('deleted_at'),
});

function makeDb() {
	const captured: string[] = [];
	const db = drizzle(async (query, _params, _method) => {
		captured.push(query);
		return { rows: [] as unknown[] };
	});
	return { db, captured };
}

describe('sqlite onConflictDoNothing conflict-target WHERE placement', () => {
	it('places the WHERE clause before DO NOTHING so partial unique indexes work', () => {
		const { db } = makeDb();
		const q = db
			.insert(users)
			.values({ id: 1, email: 'a@b.c' })
			.onConflictDoNothing({ target: users.email, where: sql`${users.deletedAt} is null` })
			.toSQL();
		expect(q.sql).toMatch(/on conflict \("users"\."email"\) where "users"\."deleted_at" is null do nothing/);
		expect(q.sql).not.toMatch(/do nothing where/);
	});

	it('omits the WHERE clause when not provided', () => {
		const { db } = makeDb();
		const q = db
			.insert(users)
			.values({ id: 1, email: 'a@b.c' })
			.onConflictDoNothing({ target: users.email })
			.toSQL();
		expect(q.sql).toMatch(/on conflict \("users"\."email"\) do nothing/);
	});

	it('generated SQL is accepted by SQLite and resolves a partial unique index conflict as a no-op', () => {
		const client = new DatabaseSync(':memory:');
		client.exec(
			`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, deleted_at INTEGER);
			CREATE UNIQUE INDEX users_email_active ON users(email) WHERE deleted_at IS NULL;`,
		);
		const { db } = makeDb();
		const q = db
			.insert(users)
			.values({ id: 1, email: 'a@b.c', deletedAt: null })
			.onConflictDoNothing({ target: users.email, where: sql`${users.deletedAt} is null` })
			.toSQL();
		// first insert succeeds; the conflicting insert must be a no-op, not a syntax error
		client.prepare(q.sql).run(...(q.params as unknown[] as never[]));
		client.prepare(q.sql).run(...(q.params as unknown[] as never[]));
		const rows = client.prepare('SELECT COUNT(*) AS c FROM users').all() as { c: number | bigint }[];
		expect(Number(rows[0]!.c)).toBe(1);
		client.close();
	});
});
