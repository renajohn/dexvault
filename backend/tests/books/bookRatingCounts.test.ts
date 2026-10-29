import request from 'supertest';
import app from '../../index';
import { getDatabase } from '../../src/database';

const run = (sql: string, params: unknown[] = []) => new Promise<number>((resolve, reject) =>
  getDatabase().run(sql, params, function (this: { lastID: number }, err: Error | null) { if (err) reject(err); else resolve(this.lastID); }));

type Counts = Array<{ stars: number; count: number }>;
const at = (counts: Counts, stars: number) => counts.find(one => one.stars === stars)?.count ?? 0;
const counts = async () => (await request(app).get('/api/books/ratings/counts').expect(200)).body.counts as Counts;

describe('how the books’ stars spread', () => {
  it('counts the books on the shelves at each half, borrowed ones too, not the wished', async () => {
    const before = await counts();
    await run('INSERT INTO books (title, rating, title_status) VALUES (?, ?, ?)', [`Spread ${Math.random()}`, 2.5, 'owned']);
    await run('INSERT INTO books (title, rating, title_status) VALUES (?, ?, ?)', [`Spread ${Math.random()}`, 2.5, 'borrowed']);
    await run('INSERT INTO books (title, rating, title_status) VALUES (?, ?, ?)', [`Spread ${Math.random()}`, 2.5, 'wish']);
    expect(at(await counts(), 2.5)).toBe(at(before, 2.5) + 2);
  });
});
