import fs from 'fs';
import path from 'path';
import request from 'supertest';
import app from '../../index';
import { getDatabase } from '../../src/database';
import { filesDir, labelOf } from '../../src/services/scoreFilesService';

const tag = () => Math.random().toString(36).slice(2, 8);
const PDF = Buffer.from('%PDF-1.4\n%%EOF');

const insertScore = (title: string) =>
  new Promise<number>((resolve, reject) =>
    getDatabase().run(`INSERT INTO books (title, authors, book_type, title_status, format) VALUES (?, '[]', 'score', 'owned', 'physical')`,
      [title], function (this: { lastID: number }, err: Error | null) { if (err) reject(err); else resolve(this.lastID); }));

const ebookFileOf = (id: number) => new Promise<string | null>((resolve, reject) =>
  getDatabase().get('SELECT ebook_file FROM books WHERE id = ?', [id], (err: Error | null, row: { ebook_file: string | null }) => (err ? reject(err) : resolve(row.ebook_file))));

const send = (id: number, name: string, label?: string) => {
  const req = request(app).post(`/api/scores/${id}/files`).attach('file', PDF, { filename: name, contentType: 'application/pdf' });
  return label ? req.field('label', label) : req;
};

describe('le nom lisible d’un fichier', () => {
  it.each([
    ['book_12_1730000000_Debussy_Preludes_I.pdf', 'Debussy Preludes I'],
    ['score_3_1730000000_Mon_Henle.pdf', 'Mon Henle'],
    ['scan.pdf', 'scan'],
    ['book_1_2_.pdf', 'PDF'],
  ])('%s → %s', (filename, label) => expect(labelOf(filename)).toBe(label));
});

describe('les PDF d’une partition', () => {
  it('en garde plusieurs : le premier s’ouvre d’abord, on renomme, on change celui qui s’ouvre, on efface', async () => {
    const id = await insertScore(`Préludes ${tag()}`);

    let files = (await send(id, 'IMSLP_Durand_1910.pdf').expect(201)).body;
    expect(files).toEqual([expect.objectContaining({ label: 'IMSLP Durand 1910', isDefault: true, source: 'upload', size: PDF.length })]);
    expect(await ebookFileOf(id)).toBe(files[0].filename);

    files = (await send(id, 'scan.pdf', 'Mon Henle annoté').expect(201)).body;
    expect(files.map((f: { label: string }) => f.label)).toEqual(['IMSLP Durand 1910', 'Mon Henle annoté']);
    const [durand, henle] = files;

    const list = (await request(app).get('/api/scores').expect(200)).body;
    expect(list.find((s: { id: number }) => s.id === id)).toMatchObject({ fileCount: 2, ebookFile: durand.filename });

    files = (await request(app).put(`/api/scores/${id}/files/${henle.id}`).send({ label: '  Mon exemplaire ', isDefault: true }).expect(200)).body;
    expect(files[0]).toMatchObject({ id: henle.id, label: 'Mon exemplaire', isDefault: true });
    expect(files[1]).toMatchObject({ id: durand.id, isDefault: false });
    expect(await ebookFileOf(id)).toBe(henle.filename);
    await request(app).put(`/api/scores/${id}/files/${henle.id}`).send({ label: ' ' }).expect(400);

    const pdf = await request(app).get(`/api/scores/${id}/files/${durand.id}/pdf`).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toMatch(/^inline; filename\*=UTF-8''IMSLP%20Durand%201910\.pdf/);

    files = (await request(app).delete(`/api/scores/${id}/files/${henle.id}`).expect(200)).body;
    expect(files).toEqual([expect.objectContaining({ id: durand.id, isDefault: true })]);
    expect(fs.existsSync(path.join(filesDir(), henle.filename))).toBe(false);
    expect(await ebookFileOf(id)).toBe(durand.filename);

    expect((await request(app).delete(`/api/scores/${id}/files/${durand.id}`).expect(200)).body).toEqual([]);
    expect(await ebookFileOf(id)).toBeNull();
  });

  it('ne prend qu’un PDF, et seulement pour une partition', async () => {
    const id = await insertScore(`Kinderszenen ${tag()}`);
    await request(app).post(`/api/scores/${id}/files`).attach('file', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' }).expect(400);
    await send(999999, 'lost.pdf').expect(404);
    expect(fs.readdirSync(filesDir()).some(name => name.startsWith('score_999999_'))).toBe(false);
    await request(app).get(`/api/scores/${id}/files/999999/pdf`).expect(404);
  });

  it('s’en vont avec la partition', async () => {
    const id = await insertScore(`Consolations ${tag()}`);
    const files = (await send(id, 'a.pdf').expect(201)).body;
    await send(id, 'b.pdf').expect(201);
    const names = (await request(app).get(`/api/scores/${id}/files`).expect(200)).body.map((f: { filename: string }) => f.filename);
    expect(names).toHaveLength(2);
    expect(files[0].filename).toBe(names[0]);

    await request(app).delete(`/api/books/${id}`).expect(200);
    for (const name of names) expect(fs.existsSync(path.join(filesDir(), name))).toBe(false);
    const left = await new Promise<number>((resolve, reject) =>
      getDatabase().get('SELECT COUNT(*) AS n FROM score_files WHERE book_id = ?', [id], (err: Error | null, row: { n: number }) => (err ? reject(err) : resolve(row.n))));
    expect(left).toBe(0);
  });
});
