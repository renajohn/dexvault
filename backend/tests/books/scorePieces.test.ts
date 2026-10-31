import request from 'supertest';
import app from '../../index';
import { getDatabase } from '../../src/database';
import musicbrainzService from '../../src/services/musicbrainzService';
import wikidataWorksService from '../../src/services/wikidataWorksService';
import imslpWorksService, { catalogueFor, piecesOf, unwiki } from '../../src/services/imslpWorksService';
import scorePiecesService, { catalogueOf, partLabel, workWordsOf } from '../../src/services/scorePiecesService';

const run = (sql: string, params: unknown[] = []) => new Promise<number>((resolve, reject) =>
  getDatabase().run(sql, params, function (this: { lastID: number }, err: Error | null) { if (err) reject(err); else resolve(this.lastID); }));
const uuid = (n: number, tag: string) => `${tag}-0000-0000-0000-${String(n).padStart(12, "0")}`;
const tag = () => Math.random().toString(16).slice(2, 10).padEnd(8, '0');

const BOOK = 'Préludes, Livre I, L. 117, CD 125';
const PRELUDES = ['Danseuses de Delphes. Lent et grave', 'Voiles. Modéré', 'Le Vent dans la plaine. Animé'];

beforeEach(() => {
  // Wikidata is asked for IMSLP pages and for the works MusicBrainz lacks: never the network in a test.
  jest.spyOn(wikidataWorksService, 'byMusicBrainz').mockResolvedValue(null);
  jest.spyOn(wikidataWorksService, 'searchWorks').mockResolvedValue([]);
  jest.spyOn(wikidataWorksService, 'works').mockResolvedValue([]);
  jest.spyOn(imslpWorksService, 'searchWorks').mockResolvedValue([]);
  jest.spyOn(imslpWorksService, 'work').mockResolvedValue(null);
});
afterEach(() => jest.restoreAllMocks());

describe('ce que dit le titre d’une partition', () => {
  it('lit ses numéros de catalogue', () => {
    expect(catalogueOf('Bach : suites françaises BWV 812-817 - piano')).toEqual(['BWV 812', 'BWV 813', 'BWV 814', 'BWV 815', 'BWV 816', 'BWV 817']);
    expect(catalogueOf('Piano Sonata no.14 op.27/2 - "Moonlight"')).toEqual(['op. 27 no. 2']);
    expect(catalogueOf('Fantasy D Minor KV 397 (385g)')).toEqual(['K. 397']);
    expect(catalogueOf('Lettre à Élise WoO 59')).toEqual(['WoO 59']);
  });

  it('garde les mots de l’œuvre, sans l’instrument, l’édition ni le compositeur', () => {
    expect(workWordsOf('Préludes Vol. 1 - piano - (HN 383)', 'Claude Debussy')).toBe('Préludes Vol. 1');
    expect(workWordsOf('BRAHMS - Valses Op.39 para Piano (Urtext)', 'Johannes Brahms')).toBe('Valses');
    expect(workWordsOf('Berceuse Opus 57 en réb Majeur --- Piano', 'Frédéric Chopin')).toBe('Berceuse en réb Majeur');
  });

  it('nomme une partie par son nom, son tempo à part', () => {
    expect(partLabel(BOOK, `${BOOK}: II. Voiles. Modéré`)).toEqual({ name: 'Voiles', sub: 'Modéré' });
    expect(partLabel(BOOK, `${BOOK}: VIII. La fille aux cheveux de lin. Très calme et doucement expressif`)).toEqual({ name: 'La fille aux cheveux de lin', sub: 'Très calme et doucement expressif' });
    expect(partLabel('Consolations, S. 172', 'Consolation in E major, S. 172 no. 1')).toEqual({ name: 'Consolation in E major, S. 172 no. 1', sub: null });
  });
});

describe('ce que dit une page d’IMSLP', () => {
  it('lit les pièces de sa liste, leurs numéros et leurs pages', () => {
    const text = `{{#fte:imslppage\n|Opus/Catalogue Number=Op.23\n|Number of Movements/Sections=4 pieces:\n#{{LinkWork|Ballade No.1|Op.23|Chopin|Frédéric}}\n#Andante con moto, {{MWV|U|86}}<br>({{K|E}})\n|Key=\n}}`;
    expect(piecesOf(text, 'Op.23')).toEqual([
      { title: 'Ballade No.1', catalogue: 'op. 23', page: 'Ballade No.1, Op.23 (Chopin, Frédéric)' },
      { title: 'Andante con moto, U 86 (in E)', catalogue: 'op. 23 no. 2', page: null },
    ]);
  });

  it('numérote les pièces qu’elle ne fait que compter', () => {
    expect(piecesOf('\n|Number of Movements/Sections=25 studies\n|Key=', 'Op.100').map(p => [p.title, p.catalogue]).slice(0, 2))
      .toEqual([['No. 1', 'op. 100 no. 1'], ['No. 2', 'op. 100 no. 2']]);
  });

  it('écrit les numéros comme MusicBrainz', () => {
    expect(catalogueFor('Op.10 No.3')).toBe('op. 10 no. 3');
    expect(catalogueFor('S.172 ; LW.A111b')).toBe('S. 172');
    expect(catalogueFor('MWV U 86')).toBeNull();
    expect(unwiki("''Venetianisches Gondellied'' [[Foo|bar]] {{K|f#}}")).toBe('Venetianisches Gondellied bar in f-sharp');
  });
});

describe('les pièces d’une partition et les enregistrements de la musique', () => {
  it('relie les pièces aux pistes qui les jouent, par l’œuvre et l’œuvre dont elle fait partie', async () => {
    const t = tag();
    const book = uuid(0, t);
    const parts = PRELUDES.map((title, i) => ({ id: uuid(i + 1, t), title: `${BOOK}: ${['I', 'II', 'III'][i]}. ${title}` }));
    const release = uuid(90, t);
    const recording = (n: number) => uuid(100 + n, t);

    // Two albums: the whole book on one, a single prélude found by search on the other.
    const cd = await run(`INSERT INTO albums (title, artist, title_status, musicbrainz_release_id, release_year, rating) VALUES (?, '["Claude Debussy","Ruth Schmid-Gagnebin"]', 'owned', ?, 2003, 4)`, [`24 Préludes ${t}`, release]);
    const other = await run(`INSERT INTO albums (title, artist, title_status, musicbrainz_release_id, release_year) VALUES (?, '["Various"]', 'digital', ?, 1990)`, [`Piano dreams ${t}`, uuid(91, t)]);
    for (let i = 0; i < 3; i++) {
      await run(`INSERT INTO tracks (album_id, disc_number, track_number, title, duration_sec, musicbrainz_recording_id, composers, performers) VALUES (?, 1, ?, ?, ?, ?, '["Claude Debussy"]', '[{"name":"Ruth Schmid-Gagnebin","role":"piano"}]')`,
        [cd, i + 1, PRELUDES[i], 150 + i, recording(i)]);
    }
    await run(`INSERT INTO tracks (album_id, disc_number, track_number, title, duration_sec, musicbrainz_recording_id, composers) VALUES (?, 1, 4, 'Voiles', 170, ?, '["Claude Debussy"]')`, [other, recording(9)]);
    const score = await run(`INSERT INTO books (title, authors, book_type, title_status, composer, publisher) VALUES (?, '[]', 'score', 'owned', 'Claude Debussy', 'G. Henle Verlag')`, [`Préludes Vol. 1 ${t}`]);

    const parent = { id: book, title: BOOK };
    jest.spyOn(musicbrainzService, 'getReleaseRecordingWorks').mockImplementation(async id => new Map(id === release
      ? parts.map((part, i) => [recording(i), [{ id: part.id, title: part.title, parentIds: [book], parents: [parent] }]])
      : []));
    jest.spyOn(musicbrainzService, 'getRecordingWorks').mockImplementation(async id =>
      (id === recording(9) ? [{ id: parts[1].id, title: parts[1].title, parentIds: [book], parents: [parent] }] : []));
    const lookups = jest.spyOn(musicbrainzService, 'getWorkWithParts').mockImplementation(async id => ({ id, title: BOOK, parentIds: [], parents: [], parts }));

    expect(await scorePiecesService.indexAll()).toEqual(expect.objectContaining({ recordings: 4 }));

    const pieces = (await request(app).post(`/api/scores/${score}/pieces`).send({ workIds: [book] }).expect(201)).body;
    expect(pieces).toHaveLength(1);
    const [piece] = pieces;
    expect(piece).toMatchObject({ title: BOOK, single: false });
    expect(piece.parts.map((p: { name: string; sub: string }) => [p.name, p.sub])).toEqual([['Danseuses de Delphes', 'Lent et grave'], ['Voiles', 'Modéré'], ['Le Vent dans la plaine', 'Animé']]);
    expect(piece.parts[1].recordings.map((r: { albumId: number }) => r.albumId).sort()).toEqual([cd, other].sort());
    // The most complete album first, its performer named.
    expect(piece.albums[0]).toMatchObject({ albumId: cd, covered: 3, performers: ['Ruth Schmid-Gagnebin'] });
    expect(piece.preferredAlbumId).toBe(cd);

    // Another chosen; the list counts what the music plays; the album knows its score.
    await request(app).put(`/api/scores/${score}/pieces/${piece.id}`).send({ preferredAlbumId: other }).expect(204);
    expect((await request(app).get(`/api/scores/${score}/pieces`).expect(200)).body[0].preferredAlbumId).toBe(other);
    expect((await request(app).get('/api/scores').expect(200)).body.find((s: { id: number }) => s.id === score)).toMatchObject({ pieceCount: 3, heardCount: 3 });
    expect((await request(app).get(`/api/music/albums/${cd}/scores`).expect(200)).body).toEqual([expect.objectContaining({ id: score })]);

    // Its parts are read once.
    expect(lookups).toHaveBeenCalledTimes(1);

    // It holds Voiles alone: the others are left out, still offered to choose, and the album still knows it.
    await request(app).put(`/api/scores/${score}/pieces/${piece.id}/parts`).send({ workIds: [] }).expect(400);
    const [voiles] = (await request(app).put(`/api/scores/${score}/pieces/${piece.id}/parts`).send({ workIds: [parts[1].id] }).expect(200)).body;
    expect(voiles.parts.map((p: { name: string }) => p.name)).toEqual(['Voiles']);
    expect(voiles.choices.map((c: { name: string; kept: boolean }) => [c.name, c.kept])).toEqual([['Danseuses de Delphes', false], ['Voiles', true], ['Le Vent dans la plaine', false]]);
    expect(voiles.albums.map((a: { albumId: number; covered: number }) => [a.albumId, a.covered])).toEqual([[other, 1], [cd, 1]]);
    expect((await request(app).get('/api/scores').expect(200)).body.find((s: { id: number }) => s.id === score)).toMatchObject({ pieceCount: 1, heardCount: 1 });
    expect((await request(app).get(`/api/music/albums/${cd}/scores`).expect(200)).body).toEqual([expect.objectContaining({ id: score })]);
    await request(app).put(`/api/scores/${score}/pieces/${piece.id}/parts`).send({ workIds: parts.map(part => part.id) }).expect(200);
    expect((await request(app).get(`/api/scores/${score}/pieces`).expect(200)).body[0].parts).toHaveLength(3);

    // Its suggestions leave out what it holds already.
    jest.spyOn(musicbrainzService, 'searchWorks').mockResolvedValue([]);
    expect((await request(app).get(`/api/scores/${score}/suggestions`).expect(200)).body).toEqual([]);

    await request(app).delete(`/api/scores/${score}/pieces/${piece.id}`).expect(204);
    expect((await request(app).get(`/api/scores/${score}/pieces`).expect(200)).body).toEqual([]);
  });

  it('propose les œuvres que nomment ses numéros, sans leurs mouvements', async () => {
    const t = tag();
    const score = await run(`INSERT INTO books (title, authors, book_type, title_status, composer) VALUES (?, '[]', 'score', 'owned', 'Johann Sebastian Bach')`, [`Bach : suites françaises BWV 812-813 ${t}`]);
    const suite = (n: number) => uuid(n, t);
    jest.spyOn(musicbrainzService, 'searchWorks').mockImplementation(async query => {
      const n = Number(query.match(/BWV (\d+)/)?.[1]);
      if (!n) return [];
      return [
        { id: uuid(n * 10, t), title: `Französische Suite Nr. ${n - 811}, BWV ${n}: I. Allemande`, score: 100, composers: ['Johann Sebastian Bach'], disambiguation: null },
        { id: suite(n), title: `Französische Suite Nr. ${n - 811} d-Moll, BWV ${n}`, score: 95, composers: ['Johann Sebastian Bach'], disambiguation: null },
      ];
    });
    jest.spyOn(musicbrainzService, 'getWorkWithParts').mockImplementation(async id => ({ id, title: `Suite ${id}`, parentIds: [], parents: [],
      parts: [{ id: `${id.slice(0, 30)}aaaaaa`, title: 'Allemande' }] }));

    const suggestions = (await request(app).get(`/api/scores/${score}/suggestions`).expect(200)).body;

    expect(suggestions.map((s: { workId: string; why: string; parts: number }) => [s.workId, s.why, s.parts])).toEqual([[suite(812), 'number', 1], [suite(813), 'number', 1]]);
  });

  it('trouve dans Wikidata un recueil que MusicBrainz n’a pas, et relie ses pièces par leur numéro', async () => {
    const t = tag();
    const score = await run(`INSERT INTO books (title, authors, book_type, title_status, composer) VALUES ('Inventionen und Sinfonien', '[]', 'score', 'owned', 'Johann Sebastian Bach')`);
    const work = (qid: string, title: string, fields: Partial<{ mbWorkId: string; imslp: string; catalogue: string[]; partQids: string[] }> = {}) => ({
      qid, title, labels: [title], mbWorkId: null, imslp: null, catalogue: [], partQids: [], ...fields,
    });
    const items = new Map([
      ['Q1', work('Q1', 'Inventions and Sinfonias', { partQids: ['Q2', 'Q3'], imslp: 'Inventions_and_Sinfonias,_BWV_772-801_(Bach,_Johann_Sebastian)' })],
      ['Q2', work('Q2', '15 Inventions', { partQids: ['Q21', 'Q22'] })],
      ['Q3', work('Q3', '15 Sinfonias', { partQids: ['Q31'] })],
      ['Q21', work('Q21', 'Invention No. 1 in C major, BWV 772', { catalogue: ['BWV 772'], imslp: 'Invention_in_C_major,_BWV_772_(Bach,_Johann_Sebastian)' })],
      ['Q22', work('Q22', 'Invention No. 2 in C minor, BWV 773', { mbWorkId: uuid(773, t) })],
      ['Q31', work('Q31', 'Sinfonia No. 1 in C major, BWV 787', { catalogue: ['BWV 787'] })],
    ]);
    // Neither its numbers nor the music say it; MusicBrainz's search by title finds a cantata.
    jest.spyOn(musicbrainzService, 'searchWorks').mockImplementation(async query => (/BWV 772/.test(query)
      ? [{ id: uuid(772, t), title: 'Inventio Nr. 1 C-Dur, BWV 772', score: 100, composers: ['Johann Sebastian Bach'], disambiguation: null }]
      : [{ id: uuid(147, t), title: 'Kantate, BWV 147: X. Choral', score: 100, composers: ['Johann Sebastian Bach'], disambiguation: null }]));
    const asked = jest.spyOn(wikidataWorksService, 'searchWorks').mockResolvedValue([items.get('Q1')!]);
    jest.spyOn(wikidataWorksService, 'works').mockImplementation(async qids => qids.map(qid => items.get(qid)!).filter(Boolean));

    const suggestions = (await request(app).get(`/api/scores/${score}/suggestions`).expect(200)).body;

    expect(asked).toHaveBeenCalledWith('Inventionen Sinfonien', 'Johann Sebastian Bach');
    expect(suggestions.map((s: { workId: string; title: string; parts: number; why: string; likely: boolean }) => [s.workId, s.title, s.parts, s.why, s.likely]))
      .toEqual([['wd:Q2', '15 Inventions', 2, 'wikidata', true], ['wd:Q3', '15 Sinfonias', 1, 'wikidata', true]]);

    // Two clicks at once add it once.
    const [, twice] = await Promise.all([
      request(app).post(`/api/scores/${score}/pieces`).send({ workIds: ['wd:Q2'] }).expect(201),
      request(app).post(`/api/scores/${score}/pieces`).send({ workIds: ['wd:Q2'] }).expect(201),
    ]);
    expect(twice.body).toHaveLength(1);
    const [piece] = twice.body;
    expect(piece).toMatchObject({ workId: 'wd:Q2', title: '15 Inventions', single: false });
    // The first by its number, the second by the work Wikidata names; each with its IMSLP page when known.
    expect(piece.parts.map((p: { workId: string; imslp: string | null }) => [p.workId, p.imslp]))
      .toEqual([[uuid(772, t), 'Invention_in_C_major,_BWV_772_(Bach,_Johann_Sebastian)'], [uuid(773, t), null]]);
  });

  it('cherche enfin dans IMSLP, et relie chaque pièce à MusicBrainz par son numéro', async () => {
    const t = tag();
    const score = await run(`INSERT INTO books (title, authors, book_type, title_status, composer) VALUES ('Chopin: Ballads and Impromptus for Piano', '[]', 'score', 'owned', 'Frédéric Chopin')`);
    jest.spyOn(musicbrainzService, 'searchWorks').mockImplementation(async query => (/op\. 23/.test(query)
      ? [{ id: uuid(23, t), title: 'Ballade no. 1 in G minor, op. 23', score: 100, composers: ['Frédéric Chopin'], disambiguation: null }]
      : []));
    jest.spyOn(imslpWorksService, 'searchWorks').mockResolvedValue(['4 Ballades (Chopin, Frédéric)', 'Impromptus (Chopin, Frédéric)', 'Mazurkas (Chopin, Frédéric)']);
    jest.spyOn(imslpWorksService, 'work').mockImplementation(async page => ({
      page, title: page.replace(/ \(.*$/, ''), catalogue: null,
      pieces: page.startsWith('4 Ballades')
        ? [{ title: 'Ballade No.1', catalogue: 'op. 23', page: 'Ballade No.1, Op.23 (Chopin, Frédéric)' }, { title: 'Ballade No.2', catalogue: 'op. 38', page: null }]
        : [{ title: 'Impromptu No.1', catalogue: 'op. 29', page: null }],
    }));

    const suggestions = (await request(app).get(`/api/scores/${score}/suggestions`).expect(200)).body;
    expect(suggestions.map((s: { workId: string; parts: number; why: string }) => [s.workId, s.parts, s.why]))
      .toEqual([['imslp:4 Ballades (Chopin, Frédéric)', 2, 'imslp'], ['imslp:Impromptus (Chopin, Frédéric)', 1, 'imslp']]);

    const [piece] = (await request(app).post(`/api/scores/${score}/pieces`).send({ workIds: ['imslp:4 Ballades (Chopin, Frédéric)'] }).expect(201)).body;
    expect(piece).toMatchObject({ title: '4 Ballades', imslp: '4 Ballades (Chopin, Frédéric)' });
    expect(piece.parts.map((p: { workId: string; title: string; imslp: string | null }) => [p.workId, p.title, p.imslp])).toEqual([
      [uuid(23, t), 'Ballade no. 1 in G minor, op. 23', 'Ballade No.1, Op.23 (Chopin, Frédéric)'],
      ['imslp:4 Ballades (Chopin, Frédéric)#2', 'Ballade No.2', null],
    ]);
    expect((await request(app).get(`/api/scores/${score}/imslp`).expect(200)).body).toEqual({ page: '4 Ballades (Chopin, Frédéric)' });
  });

  it('mène à la page IMSLP du livre que dit son titre, ou de celle que partagent ses pièces', async () => {
    const score = await run(`INSERT INTO books (title, authors, book_type, title_status, composer) VALUES ('Préludes Vol. 1 - piano - (HN 383)', '[]', 'score', 'owned', 'Claude Debussy')`);
    for (const found of [['Préludes, Livre 2 (Debussy, Claude)', 'Préludes, Livre 1 (Debussy, Claude)'], ['Préludes, Livre 1 (Debussy, Claude)', 'Préludes, Livre 2 (Debussy, Claude)']]) {
      jest.spyOn(imslpWorksService, 'searchWorks').mockResolvedValue(found);
      expect((await request(app).get(`/api/scores/${score}/imslp`).expect(200)).body).toEqual({ page: 'Préludes, Livre 1 (Debussy, Claude)' });
    }

    // Its set has no page of its own, its preludes Livre 1's: that one, without a search.
    const t = tag();
    await run(`INSERT INTO mb_works (id, title, parent_ids, parts, imslp, fetched_at) VALUES (?, 'Préludes, Livre I', '[]', ?, NULL, '2026-10-31')`,
      [uuid(1, t), JSON.stringify([1, 2].map(n => ({ id: uuid(10 + n, t), title: `Prélude ${n}`, imslp: 'Préludes,_Livre_1_(Debussy,_Claude)' })))]);
    await run(`INSERT INTO score_pieces (book_id, work_id, title, position) VALUES (?, ?, 'Préludes, Livre I', 0)`, [score, uuid(1, t)]);
    jest.spyOn(imslpWorksService, 'searchWorks').mockResolvedValue(['Préludes, Livre 2 (Debussy, Claude)']);
    expect((await request(app).get(`/api/scores/${score}/imslp`).expect(200)).body).toEqual({ page: 'Préludes,_Livre_1_(Debussy,_Claude)' });
  });

  it('refuse ce qui n’est pas une partition', async () => {
    const book = await run(`INSERT INTO books (title, authors, book_type, title_status) VALUES ('Dune', '[]', 'book', 'owned')`);
    await request(app).get(`/api/scores/${book}/pieces`).expect(404);
    await request(app).post(`/api/scores/${book}/pieces`).send({ title: 'x' }).expect(404);
  });
});
