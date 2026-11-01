import fs from 'fs';
import path from 'path';
import axios from 'axios';
import AdmZip from 'adm-zip';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import app from '../../index';
import { getDatabase } from '../../src/database';
import { composerOf, composersOf, entriesOf, keysOf, matchPieces, MutopiaEntry, wholeIn, Wanted } from '../../src/services/mutopiaService';

afterEach(() => jest.restoreAllMocks());

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

const entry = (id: string, title: string, opus: string | null, instrument = 'Piano'): MutopiaEntry => ({
  id, title, opus, instrument, source: null, licence: 'Public Domain', pdf: `https://www.mutopiaproject.org/ftp/X/${id}/${id}-a4.pdf`, preview: null,
});
const part = (pieceId: number, name: string, title: string, setTitle: string): Wanted => ({ pieceId, partWorkId: `w-${name}`, name, title, setTitle, whole: false });
const set = (pieceId: number, title: string): Wanted => ({ pieceId, partWorkId: null, name: title, title, whole: true });
const checkedOf = (targets: ReturnType<typeof matchPieces>) => targets.map(target => target.candidates.filter(c => c.checked).map(c => c.title));

describe('la liste de Mutopia', () => {
  it('lit ses pièces : titre, numéro, instrument, édition, licence, PDF en A4 et premières mesures', () => {
    const entries = entriesOf(fixture('mutopia-schumann.html'));
    expect(entries).toHaveLength(10);
    expect(entries[0]).toEqual({
      id: '354', title: 'Kinderscenen - Von fremden Ländern und Menschen', opus: 'O 15 N 1', instrument: 'Piano',
      source: 'Leichte Stucke, 1900', licence: 'Public Domain',
      pdf: 'https://www.mutopiaproject.org/ftp/SchumannR/O15/SchumannOp15No01/SchumannOp15No01-a4.pdf',
      preview: 'https://www.mutopiaproject.org/ftp/SchumannR/O15/SchumannOp15No01/SchumannOp15No01-preview.png',
    });
  });

  it('prend le zip des PDF d’une œuvre en plusieurs mouvements', () => {
    const entries = entriesOf(fixture('mutopia-bach-french-suites.html'));
    expect(entries.map(e => [e.title, e.opus, e.pdf])).toEqual([
      ['French Suite no. 3 in B minor', 'BWV 814', 'https://www.mutopiaproject.org/ftp/BachJS/BWV814/french-suite-3/french-suite-3-a4-pdfs.zip'],
      ['French Suite no. 5 in G major', 'BWV 816', 'https://www.mutopiaproject.org/ftp/BachJS/BWV816/french-suite-5/french-suite-5-a4-pdfs.zip'],
      ['French Suite no. 6 in E major', 'BWV 817', 'https://www.mutopiaproject.org/ftp/BachJS/BWV817/french-suite-6/french-suite-6-a4-pdfs.zip'],
    ]);
  });

  it('reconnaît le compositeur : même nom, mêmes initiales', () => {
    const composers = composersOf(`<a href='cgibin/make-table.cgi?Composer=BachCPE'>C. P. E. Bach (1714–1788)</a> [2]<br />
      <a href='cgibin/make-table.cgi?Composer=BachJS'>J. S. Bach (1685–1750)</a> [417]<br />
      <a href='cgibin/make-table.cgi?Composer=BeethovenLv'>L. V. Beethoven (1770–1827)</a> [77]<br />
      <a href='cgibin/make-table.cgi?Composer=ChopinFF'>F. F. Chopin (1810–1849)</a> [47]<br />`);
    expect(composerOf(composers, 'Johann Sebastian Bach')).toEqual({ code: 'BachJS', name: 'J. S. Bach', count: 417 });
    expect(composerOf(composers, 'Ludwig van Beethoven')?.code).toBe('BeethovenLv');
    expect(composerOf(composers, 'Frédéric Chopin')?.code).toBe('ChopinFF');
    expect(composerOf(composers, 'Felix Mendelssohn')).toBeNull();
  });
});

describe('les numéros d’un titre', () => {
  it.each([
    ['Kinderszenen, op. 15: No. 7. Träumerei', [{ system: 'op', main: 15, sub: 7 }]],
    ['Kinderscenen - Traümerei O 15 N 7', [{ system: 'op', main: 15, sub: 7 }]],
    ['Album pour la jeunesse - 1.Mélodie O 68 n°1', [{ system: 'op', main: 68, sub: 1 }]],
    ['Sonate n° 14 op. 27/2', [{ system: 'op', main: 27, sub: 2 }]],
    ['Menuet G-dur, BWV Anh.114', [{ system: 'bwvanh', main: 114, sub: null }]],
    ['Menuet BWV Anh 114,115,116 pour violons ou altos', [114, 115, 116].map(main => ({ system: 'bwvanh', main, sub: null }))],
    ['8a. Polonaise F-dur, BWV Anh.117a', [{ system: 'bwvanha', main: 117, sub: null }]],
    ['Prelude and Fugue no. 1 in C major, BWV 846', [{ system: 'bwv', main: 846, sub: null }]],
    ['Das wohltemperierte Klavier I, BWV 846–869', []],
    ['Erbauliche Gedanken eines Tabakrauchers BWV 515a', [{ system: 'bwva', main: 515, sub: null }]],
    ['Französische Suite Nr. 1 d-Moll, BWV 812.2/812', [{ system: 'bwv', main: 812, sub: null }]],
    ['Prélude 4 CD 125; L.117', [{ system: 'l', main: 117, sub: null }]],
  ])('%s', (title, keys) => expect(keysOf(title)).toEqual(keys));

  it('lit le chiffre romain d’une partie quand on le lui demande', () => {
    expect(keysOf('Suite bergamasque, L. 75, CD 82 : III. Clair de lune', true)).toEqual([{ system: 'l', main: 75, sub: 3 }]);
  });
});

describe('les pièces de Mutopia pour celles d’une partition', () => {
  it('trouve chaque partie d’un recueil par son numéro dans le recueil', () => {
    const kinder = 'Kinderszenen, op. 15';
    const targets = matchPieces([
      part(1, 'No. 7. Träumerei', `${kinder}: No. 7. Träumerei`, kinder),
      part(1, 'No. 8. Am Kamin', `${kinder}: No. 8. Am Kamin`, kinder),
      set(1, kinder),
    ], [entry('504', 'Kinderscenen - Traümerei', 'O 15 N 7'), entry('2210', 'Widmung', 'O 25')]);
    expect(checkedOf(targets)).toEqual([['Kinderscenen - Traümerei'], [], []]);
  });

  it('trouve par son nom une partie que Mutopia ne numérote pas', () => {
    const suite = 'Suite bergamasque, L. 75, CD 82';
    const targets = matchPieces([
      part(1, 'Clair de lune', `${suite} : III. Clair de lune`, suite),
      part(1, 'Menuet', `${suite} : II. Menuet`, suite),
    ], [entry('1', 'Suite Bergamasque: Clair de Lune', 'L75')]);
    expect(checkedOf(targets)).toEqual([['Suite Bergamasque: Clair de Lune'], []]);
  });

  it('donne une sonate entière à la sonate, pas à chacun de ses mouvements', () => {
    const sonata = 'Sonata for Piano no. 14 in C‐sharp minor, op. 27 no. 2 “Moonlight”';
    const targets = matchPieces([
      part(1, 'Adagio sostenuto', `${sonata}: I. Adagio sostenuto`, sonata),
      part(1, 'Presto agitato', `${sonata}: III. Presto agitato`, sonata),
      set(1, sonata),
    ], [entry('1', 'Sonata No. 14 “Moonlight”', 'Op. 27, No. 2')]);
    expect(checkedOf(targets)).toEqual([[], [], ['Sonata No. 14 “Moonlight”']]);
  });

  it('coche le livre entier plutôt que ses préludes quand Mutopia l’a', () => {
    const book = 'Préludes, Livre I, L. 117, CD 125';
    const targets = matchPieces([
      part(1, '« Les sons et les parfums tournent dans l’air du soir »', `${book}: IV. « Les sons et les parfums tournent dans l’air du soir »`, book),
      set(1, book),
    ], [entry('1', "Prélude 4: Les sons et les parfums tournent dans l'air du soir", 'CD 125; L.117'), entry('2', 'Debussy Préludes, Book 1', 'CD 125; L.117')]);
    expect(targets.map(t => t.candidates.map(c => [c.title, c.checked]))).toEqual([
      [["Prélude 4: Les sons et les parfums tournent dans l'air du soir", false]],
      [['Debussy Préludes, Book 1', true]],
    ]);
  });

  it('coche une version de chaque pièce, pour le clavier, le prélude avant sa fugue', () => {
    const targets = matchPieces([
      { pieceId: 1, partWorkId: null, name: 'Prelude: Op. 28, No. 4', title: 'Prélude no. 4 in E minor, op. 28: Largo', whole: false },
      { pieceId: 2, partWorkId: null, name: 'Prelude and Fugue no. 1', title: 'Prelude and Fugue no. 1 in C major, BWV 846', whole: false },
    ], [
      entry('1', "Prelude: Op. 28, No. 4 ('Suffocation')", 'Op. 28'),
      entry('2', 'Prelude: Op. 28, No. 4 (from Peters source)', 'Op. 28'),
      entry('3', 'Das Wohltemperierte Clavier I, Fuga I', 'BWV 846', 'Harpsichord, Piano'),
      entry('4', 'Das Wohltemperierte Klavier I, Praeludium I', 'BWV 846', '2 Guitars'),
      entry('5', 'Das Wohltemperierte Clavier I, Praeludium I', 'BWV 846', 'Harpsichord, Piano'),
    ]);
    expect(checkedOf(targets)).toEqual([
      ["Prelude: Op. 28, No. 4 ('Suffocation')"],
      ['Das Wohltemperierte Clavier I, Praeludium I', 'Das Wohltemperierte Clavier I, Fuga I'],
    ]);
  });

  it('trouve les menuets du Petit livre d’Anna Magdalena par leur numéro de l’Anhang, pas par leur nom', () => {
    const book = 'Notebook for Anna Magdalena Bach';
    const targets = matchPieces([
      part(1, 'Menuet F-dur, BWV Anh.113', 'Menuet F-dur, BWV Anh.113', book),
      part(1, 'Menuet G-dur, BWV Anh.114', 'Menuet G-dur, BWV Anh.114', book),
      part(1, '8a. Polonaise F-dur, BWV Anh.117a', '8a. Polonaise F-dur, BWV Anh.117a', book),
    ], [
      entry('1', 'Menuet', 'BWV Anh. 113', 'Harpsichord, Piano, Clavichord'),
      entry('2', 'Menuet', 'BWV Anh. 114', 'Harpsichord, Piano, Clavichord'),
      entry('3', 'Menuet BWV Anh 114,115,116 pour violons ou altos', 'BWV Anh. 114, 115, 116', 'Violin, Viola'),
      entry('4', 'Polonaise in F major', 'BWV Anh. 117a'),
      entry('5', 'Polonaise in F major', 'BWV Anh. 117b'),
    ]);
    expect(targets.map(t => t.candidates.map(c => [c.id, c.checked]))).toEqual([
      [['1', true]],
      [['2', true], ['3', false]],
      [['4', true]],
    ]);
  });

  it('ne coche qu’une fois une pièce que la partition a deux fois', () => {
    const book = 'Notebook for Anna Magdalena Bach';
    const suite = 'Französische Suite Nr. 3 h-Moll, BWV 814';
    const targets = matchPieces([part(1, suite, suite, book), { ...part(1, suite, suite, book), partWorkId: 'w-again' }],
      [entry('1', 'French Suite no. 3 in B minor', 'BWV 814', 'Harpsichord, Piano')]);
    expect(checkedOf(targets)).toEqual([['French Suite no. 3 in B minor'], []]);
  });

  it('de trente pièces sous un même numéro, coche celle que son nom dit', () => {
    const goldberg = ['Aria', ...Array.from({ length: 5 }, (_, i) => String(i + 1))].map((n, i) => entry(String(i), `Goldberg Variations - ${n}`, 'BWV 988', 'Harpsichord,Clavichord'));
    const [target] = matchPieces([{ pieceId: 1, partWorkId: 'w', name: 'Aria für Klavier G-dur, BWV 988 No.1', title: 'Aria für Klavier G-dur, BWV 988 No.1', whole: false }], goldberg);
    expect(target.candidates).toHaveLength(6);
    expect(target.candidates.filter(c => c.checked).map(c => c.title)).toEqual(['Goldberg Variations - Aria']);
  });
});

const pdfOf = async (pages: number) => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([595, 842]);
  return Buffer.from(await doc.save());
};

describe('les pièces prises sur Mutopia', () => {
  it('trouve l’œuvre entière dans le zip de ses mouvements', async () => {
    const zip = new AdmZip();
    zip.addFile('bach-french-suite-3-gigue-a4.pdf', await pdfOf(1));
    zip.addFile('french-suite-3-a4.pdf', await pdfOf(7));
    const whole = await PDFDocument.load(await wholeIn(zip.toBuffer(), 'https://www.mutopiaproject.org/ftp/BachJS/BWV814/french-suite-3/french-suite-3-a4-pdfs.zip'));
    expect(whole.getPageCount()).toBe(7);
  });

  // french-suite-5-a4-pdfs.zip: its seven movements alone, alphabetical, each
  // here a page as wide as its place in the zip, to read the order back.
  const MOVEMENTS = ['allemande', 'bourree', 'courante', 'gavotte', 'gigue', 'loure', 'sarabande'];
  const suite5 = async () => {
    const zip = new AdmZip();
    for (const [i, name] of MOVEMENTS.entries()) {
      const doc = await PDFDocument.create();
      doc.addPage([101 + i, 842]);
      zip.addFile(`french-suite-5-${name}-a4.pdf`, Buffer.from(await doc.save()));
    }
    return zip.toBuffer();
  };
  const suite5Url = 'https://www.mutopiaproject.org/ftp/BachJS/BWV816/french-suite-5/french-suite-5-a4-pdfs.zip';
  const movementsOf = async (pdf: Buffer) =>
    (await PDFDocument.load(pdf)).getPages().map(page => MOVEMENTS[Math.round(page.getWidth()) - 101]);

  it('réunit les mouvements d’un zip sans l’œuvre entière, dans l’ordre des parties de la pièce', async () => {
    const names = ['I. Allemande', 'II. Courante', 'III. Sarabande', 'IV. Gavotte', 'V. Bourrée', 'VI. Loure', 'VII. Gigue']
      .map(name => `Französische Suite Nr. 5 G-Dur, BWV 816: ${name}`);
    expect(await movementsOf(await wholeIn(await suite5(), suite5Url, names)))
      .toEqual(['allemande', 'courante', 'sarabande', 'gavotte', 'bourree', 'loure', 'gigue']);
  });

  it('sans les parties, dans l’ordre d’une suite, la gigue en dernier', async () => {
    expect(await movementsOf(await wholeIn(await suite5(), suite5Url, ['Französische Suite Nr. 5'])))
      .toEqual(['allemande', 'courante', 'sarabande', 'bourree', 'gavotte', 'loure', 'gigue']);
  });

  const insert = (sql: string, params: unknown[]) => new Promise<number>((resolve, reject) =>
    getDatabase().run(sql, params, function (this: { lastID: number }, err: Error | null) { if (err) reject(err); else resolve(this.lastID); }));

  it('les réunit en un PDF, chaque pièce marquée à ses pages', async () => {
    const id = await insert(`INSERT INTO books (title, authors, book_type, title_status, format) VALUES (?, '[]', 'score', 'owned', 'physical')`, ['Préludes Mutopia']);
    const first = await insert('INSERT INTO score_pieces (book_id, title, position) VALUES (?, ?, 1)', [id, 'Prélude et fugue I']);
    const second = await insert('INSERT INTO score_pieces (book_id, title, position) VALUES (?, ?, 2)', [id, 'Prélude II']);
    const pdfs: Record<string, Buffer> = { 'p1-a4.pdf': await pdfOf(2), 'f1-a4.pdf': await pdfOf(3), 'p2-a4.pdf': await pdfOf(1) };
    jest.spyOn(axios, 'get').mockImplementation(async (url: string) => ({ data: pdfs[path.basename(url)] }));
    const at = (name: string) => `https://www.mutopiaproject.org/ftp/BachJS/BWV846/${name}`;

    const files = (await request(app).post(`/api/scores/${id}/mutopia`).send({ picks: [
      { pieceId: first, partWorkId: null, pdf: at('p1-a4.pdf') },
      { pieceId: first, partWorkId: null, pdf: at('f1-a4.pdf') },
      { pieceId: second, partWorkId: null, pdf: at('p2-a4.pdf') },
    ] }).expect(201)).body;
    expect(files).toEqual([expect.objectContaining({ label: 'Mutopia Project', source: 'mutopia', isDefault: true, pageCount: 6 })]);
    const marks = (await request(app).get(`/api/scores/${id}/files/${files[0].id}/bookmarks`).expect(200)).body;
    expect(marks).toEqual([
      { pieceId: first, partWorkId: null, startPage: 1, endPage: 5 },
      { pieceId: second, partWorkId: null, startPage: 6, endPage: 6 },
    ]);
  });

  it('ne va chercher que les fichiers de Mutopia, pour les pièces de la partition', async () => {
    const id = await insert(`INSERT INTO books (title, authors, book_type, title_status, format) VALUES (?, '[]', 'score', 'owned', 'physical')`, ['Ailleurs']);
    const piece = await insert('INSERT INTO score_pieces (book_id, title, position) VALUES (?, ?, 1)', [id, 'Une pièce']);
    const get = jest.spyOn(axios, 'get');
    await request(app).post(`/api/scores/${id}/mutopia`).send({ picks: [{ pieceId: piece, pdf: 'https://example.com/ftp/x-a4.pdf' }] }).expect(400);
    await request(app).post(`/api/scores/${id}/mutopia`).send({ picks: [{ pieceId: piece, pdf: 'https://www.mutopiaproject.org/ftp/../etc/x.pdf' }] }).expect(400);
    await request(app).post(`/api/scores/${id}/mutopia`).send({ picks: [{ pieceId: 999999, pdf: 'https://www.mutopiaproject.org/ftp/A/x-a4.pdf' }] }).expect(400);
    await request(app).post(`/api/scores/${id}/mutopia`).send({ picks: [] }).expect(400);
    expect(get).not.toHaveBeenCalled();
  });
});
