import fs from 'fs';
import path from 'path';
import request from 'supertest';
import app from '../../index';
import { getDatabase } from '../../src/database';
import { filesDir, labelOf } from '../../src/services/scoreFilesService';
import scorePiecesService from '../../src/services/scorePiecesService';
import { PDFDocument } from 'pdf-lib';
import { pagesOf } from '../../src/services/scorePrintService';
import imslpEditionsService, { editionsOf, plateOf, shortPublisher } from '../../src/services/imslpEditionsService';

afterEach(() => jest.restoreAllMocks());

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

describe('les éditions d’une œuvre sur IMSLP', () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'imslp-suite-bergamasque.html'), 'utf8');

  it('lit les éditions de l’onglet Scores, sans les arrangements, chacune avec son nom, son cotage et ses fichiers', () => {
    const editions = editionsOf(html);
    expect(editions.map(e => [e.section, e.name])).toEqual([
      ['Complete', 'E. Fromont, 1905'],
      ['Complete', 'Jean Jobert, 1948'],
      ['Complete', 'G. Henle Verlag, 2011'],
      ['Clair de lune (No.3)', 'Jean Jobert, 1927'],
    ]);
    expect(editions[0]).toMatchObject({
      editor: 'First edition', copyright: 'Public Domain', plate: 'E. 1404 F',
      thumbnail: expect.stringMatching(/^https:\/\/cdn\.imslp\.org\//),
      files: [{ index: '83536', title: 'Complete Score', pages: 33, size: '6.07MB', downloads: 57820, download: 'https://imslp.org/wiki/Special:ImagefromIndex/83536' }],
    });
    expect(editions[2]).toMatchObject({ plate: 'HN 381', editor: 'Ernst-Günter Heinemann (b. 1945)' });
  });

  it.each([
    ['Leipzig: Edition Peters, 1970. Plate E.P. 12420b.URTEXT EDITION', 'E.P. 12420b'],
    ['Paris: Durand, 2000. Plate D. & F. 15319.URTEXT EDITION', 'D. & F. 15319'],
    ['Munich: G. Henle Verlag, 1983. Plate HN 381. URTEXT EDITION  This', 'HN 381'],
  ])('le cotage de « %s » est %s', (info, plate) => expect(plateOf(info)).toBe(plate));

  it.each([
    ['Paris: E. Fromont, 1905. Plate E. 1404 F.', 'E. Fromont, 1905'],
    ['Library of Musical Classics, Vol.1812\nNew York: G. Schirmer, n.d.(ca.1920). Plate 29811.', 'G. Schirmer, n.d.(ca.1920)'],
    ['Ray Alston, 2020.', 'Ray Alston, 2020'],
  ])('« %s » s’appelle %s', (info, name) => expect(shortPublisher(info)).toBe(name));

  it('les donne pour la page de la partition, et un PDF joint depuis IMSLP le reste', async () => {
    const id = await insertScore(`Suite bergamasque ${tag()}`);
    jest.spyOn(scorePiecesService, 'imslpPage').mockResolvedValue('Suite bergamasque, CD 82 (Debussy, Claude)');
    const editions = jest.spyOn(imslpEditionsService, 'editions').mockResolvedValue(editionsOf(html));
    const body = (await request(app).get(`/api/scores/${id}/imslp/editions`).expect(200)).body;
    expect(body.page).toBe('Suite bergamasque, CD 82 (Debussy, Claude)');
    expect(body.editions).toHaveLength(4);
    expect(editions).toHaveBeenCalledWith('Suite bergamasque, CD 82 (Debussy, Claude)');

    const files = (await send(id, 'SIBLEY1802.pdf', 'E. Fromont, 1905').field('source', 'imslp').expect(201)).body;
    expect(files[0]).toMatchObject({ label: 'E. Fromont, 1905', source: 'imslp' });
    await request(app).delete(`/api/scores/${id}/files/${files[0].id}`).expect(200);
  });

  it('ne donne rien quand la partition n’a pas de page', async () => {
    const id = await insertScore(`A Dozen a Day ${tag()}`);
    jest.spyOn(scorePiecesService, 'imslpPage').mockResolvedValue(null);
    expect((await request(app).get(`/api/scores/${id}/imslp/editions`).expect(200)).body).toEqual({ page: null, editions: [] });
  });
});

describe('les pages de chaque pièce dans un PDF', () => {
  const insertPiece = (bookId: number, title: string) => new Promise<number>((resolve, reject) =>
    getDatabase().run('INSERT INTO score_pieces (book_id, title) VALUES (?, ?)', [bookId, title],
      function (this: { lastID: number }, err: Error | null) { if (err) reject(err); else resolve(this.lastID); }));

  it('les garde toutes à la fois, une partie d’un recueil par son œuvre, et retient le nombre de pages', async () => {
    const id = await insertScore(`Préludes ${tag()}`);
    const livre = await insertPiece(id, 'Préludes, Livre I');
    const clair = await insertPiece(id, 'Clair de lune');
    const [file] = (await send(id, 'preludes.pdf').expect(201)).body;

    const marks = (await request(app).put(`/api/scores/${id}/files/${file.id}/bookmarks`).send({ pageCount: 60, bookmarks: [
      { pieceId: clair, partWorkId: null, startPage: 50, endPage: 55 },
      { pieceId: livre, partWorkId: 'w-danseuses', startPage: 3, endPage: 5 },
      { pieceId: livre, partWorkId: 'w-voiles', startPage: 5, endPage: 8 },
    ] }).expect(200)).body;
    expect(marks).toEqual([
      { pieceId: livre, partWorkId: 'w-danseuses', startPage: 3, endPage: 5 },
      { pieceId: livre, partWorkId: 'w-voiles', startPage: 5, endPage: 8 },
      { pieceId: clair, partWorkId: null, startPage: 50, endPage: 55 },
    ]);
    expect((await request(app).get(`/api/scores/${id}/files`).expect(200)).body[0]).toMatchObject({ pageCount: 60 });

    // Kept again: those left out are gone.
    await request(app).put(`/api/scores/${id}/files/${file.id}/bookmarks`).send({ bookmarks: [{ pieceId: clair, startPage: 50, endPage: 52 }] }).expect(200);
    expect((await request(app).get(`/api/scores/${id}/files/${file.id}/bookmarks`).expect(200)).body).toEqual([{ pieceId: clair, partWorkId: null, startPage: 50, endPage: 52 }]);

    // A piece taken out takes its pages with it.
    await request(app).delete(`/api/scores/${id}/pieces/${clair}`).expect(204);
    expect((await request(app).get(`/api/scores/${id}/files/${file.id}/bookmarks`).expect(200)).body).toEqual([]);
    await request(app).delete(`/api/scores/${id}/files/${file.id}`).expect(200);
  });

  it('refuse des pages hors du PDF ou une pièce d’une autre partition', async () => {
    const id = await insertScore(`Valses ${tag()}`);
    const other = await insertScore(`Ballades ${tag()}`);
    const valse = await insertPiece(id, 'Valse');
    const ballade = await insertPiece(other, 'Ballade');
    const [file] = (await send(id, 'valses.pdf').expect(201)).body;
    const put = (bookmarks: unknown[]) => request(app).put(`/api/scores/${id}/files/${file.id}/bookmarks`).send({ pageCount: 20, bookmarks });
    await put([{ pieceId: valse, startPage: 5, endPage: 21 }]).expect(400);
    await put([{ pieceId: valse, startPage: 6, endPage: 5 }]).expect(400);
    await put([{ pieceId: valse, startPage: 0, endPage: 2 }]).expect(400);
    await put([{ pieceId: ballade, startPage: 1, endPage: 2 }]).expect(400);
    expect((await put([{ pieceId: valse, startPage: 4 }]).expect(200)).body).toEqual([{ pieceId: valse, partWorkId: null, startPage: 4, endPage: 4 }]);
  });
});

describe('imprimer des pièces', () => {
  const insertPiece = (bookId: number, title: string, position: number) => new Promise<number>((resolve, reject) =>
    getDatabase().run('INSERT INTO score_pieces (book_id, title, position) VALUES (?, ?, ?)', [bookId, title, position],
      function (this: { lastID: number }, err: Error | null) { if (err) reject(err); else resolve(this.lastID); }));
  // A scan of ten pages, Letter size, its page 9 wider than high, its page 8 blank.
  const scan = async () => {
    const doc = await PDFDocument.create();
    for (let page = 1; page <= 10; page += 1) {
      const sheet = doc.addPage(page === 9 ? [792, 612] : [612, 792]);
      if (page !== 8) sheet.drawRectangle({ x: 20, y: 20, width: 100, height: 100 });
    }
    return Buffer.from(await doc.save());
  };
  const binary = (res: request.Response, callback: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
  };

  it('prend chaque page une fois, dans l’ordre', () => {
    expect(pagesOf([{ startPage: 3, endPage: 5 }, { startPage: 5, endPage: 6 }, { startPage: 1, endPage: 1 }], 10)).toEqual([3, 4, 5, 6, 1]);
    expect(pagesOf([{ startPage: 9, endPage: 12 }], 10)).toEqual([9, 10]);
  });

  it('coupe les pages des pièces demandées et les pose sur A4, dans l’ordre de la partition', async () => {
    const id = await insertScore(`Suite bergamasque ${tag()}`);
    const prelude = await insertPiece(id, 'Prélude', 0);
    const clair = await insertPiece(id, 'Clair de lune', 2);
    const passepied = await insertPiece(id, 'Passepied', 3);
    const [file] = (await request(app).post(`/api/scores/${id}/files`).attach('file', await scan(), { filename: 'sb.pdf', contentType: 'application/pdf' }).expect(201)).body;
    await request(app).put(`/api/scores/${id}/files/${file.id}/bookmarks`).send({ pageCount: 10, bookmarks: [
      { pieceId: prelude, startPage: 1, endPage: 2 }, { pieceId: clair, startPage: 6, endPage: 7 }, { pieceId: passepied, startPage: 7, endPage: 9 },
    ] }).expect(200);

    const res = await request(app).get(`/api/scores/${id}/print`).query({ pieces: `${passepied}:,${clair}:` }).buffer(true).parse(binary).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/2%20pieces\.pdf$/);
    const printed = await PDFDocument.load(res.body);
    // Clair de lune 6–7, then Passepied 7–9: page 7 once.
    expect(printed.getPageCount()).toBe(4);
    expect(printed.getPages().map(page => page.getSize()).map(({ width, height }) => [Math.round(width), Math.round(height)]))
      .toEqual([[595, 842], [595, 842], [595, 842], [842, 595]]);

    const one = await request(app).get(`/api/scores/${id}/print`).query({ pieces: `${prelude}:`, name: 'Suite bergamasque – Prélude' }).buffer(true).parse(binary).expect(200);
    expect(one.headers['content-disposition']).toBe(`inline; filename*=UTF-8''${encodeURIComponent('Suite bergamasque – Prélude.pdf')}`);
    expect((await PDFDocument.load(one.body)).getPageCount()).toBe(2);
  });

  it('dit quand les pages ne sont pas marquées, ou qu’il n’y a pas de PDF', async () => {
    const id = await insertScore(`Kinderszenen ${tag()}`);
    const piece = await insertPiece(id, 'Träumerei', 0);
    await request(app).get(`/api/scores/${id}/print`).query({ pieces: `${piece}:` }).expect(404);
    await request(app).post(`/api/scores/${id}/files`).attach('file', await scan(), { filename: 'k.pdf', contentType: 'application/pdf' }).expect(201);
    await request(app).get(`/api/scores/${id}/print`).query({ pieces: `${piece}:` }).expect(400);
    await request(app).get(`/api/scores/${id}/print`).expect(400);
  });
});
