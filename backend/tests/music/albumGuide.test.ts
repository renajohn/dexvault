import axios from 'axios';
import request from 'supertest';
import app from '../../index';
import { getDatabase } from '../../src/database';
import AlbumGuide from '../../src/models/albumGuide';
import albumGuideService from '../../src/services/albumGuideService';
import albumStoryService from '../../src/services/albumStoryService';
import musicService from '../../src/services/musicService';

const insertAlbum = (genres: string[] = ['Classical'], createdAt = '2026-10-09T10:00:00.000Z') =>
  new Promise<number>((resolve, reject) =>
    getDatabase().run(
      `INSERT INTO albums (title, artist, genres, title_status, created_at) VALUES (?, '["Kremer"]', ?, 'owned', ?)`,
      [`Guide album ${Math.random()}`, JSON.stringify(genres), createdAt],
      function (this: { lastID: number }, err: Error | null) { if (err) reject(err); else resolve(this.lastID); }
    ));

const TRACKS = [
  { no: 1, title: 'La primavera: I. Allegro', durationSec: 190, performers: [{ name: 'Gidon Kremer', role: 'violin' }] },
  { no: 2, title: 'La primavera: II. Largo', durationSec: 130, performers: [] },
  { no: 3, title: 'L’estate: I. Allegro', durationSec: 300, performers: [] },
];

const STORY = {
  albumId: 0, found: true, reason: null, lang: null, title: null, url: null, intro: null, sections: [], links: [],
  fetchedAt: '2026-10-09T10:00:00.000Z',
  works: [{
    workTitle: 'Le quattro stagioni', tracks: 3, positions: [1, 2, 3], lang: 'fr', title: 'Les Quatre Saisons',
    url: 'https://fr.wikipedia.org/wiki/Les_Quatre_Saisons', intro: '', sections: [],
    links: [{ lang: 'fr', title: 'Les Quatre Saisons', url: 'https://fr.wikipedia.org/wiki/Les_Quatre_Saisons' }],
  }],
};

const DRAFT = '### Le quattro stagioni (1725), 10 min — plages 1 à 3\n**Contexte** : Publiées en 1725 à Amsterdam.\n';
const FIXED = '### Le quattro stagioni (1725), 10 min — plages 1 à 3\n**Contexte** : Publiées en 1725.\n';

/** The album, its story and Wikipedia as they would answer for a Four Seasons CD. */
const mockSources = () => {
  jest.spyOn(musicService, 'getAlbumById').mockImplementation(async (id: number) =>
    ({ id, title: 'Le quattro stagioni', artist: ['Vivaldi'], labels: ['DG'], catalogNumber: '431 172-2', releaseYear: 1990,
      editionNotes: null, discs: [{ number: 1, tracks: TRACKS }] }) as any);
  jest.spyOn(albumStoryService, 'getStory').mockResolvedValue(STORY as any);
  jest.spyOn(albumStoryService, 'readArticle').mockResolvedValue({ intro: 'Publiées en 1725 à Amsterdam par Le Cène.', sections: [] });
};

/** The local LLM: a draft, a fact check, then the fix when the check found something. */
const mockLlm = (claims: Array<{ claim: string; verdict: string; evidence: string }>) =>
  jest.spyOn(axios, 'post').mockImplementation(async (_url: string, body: any) => {
    const asks = body.messages[1].content as string;
    const content = body.response_format ? JSON.stringify({ claims })
      : asks.startsWith('BROUILLON') ? `\`\`\`markdown\n${FIXED}\n\`\`\`` : DRAFT;
    return { data: { choices: [{ message: { content } }] } };
  });

afterEach(() => jest.restoreAllMocks());

describe('routes de la fiche d’écoute', () => {
  it('n’a pas de fiche au départ, en garde une écrite à la main, puis l’efface', async () => {
    const id = await insertAlbum();
    expect((await request(app).get(`/api/music/albums/${id}/guide`)).body).toBeNull();

    const saved = await request(app).put(`/api/music/albums/${id}/guide`).send({ text: '  ### Ma fiche\nÀ écouter le soir.  ' });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ albumId: id, text: '### Ma fiche\nÀ écouter le soir.', source: 'manual', model: null });

    expect((await request(app).delete(`/api/music/albums/${id}/guide`)).status).toBe(204);
    expect((await request(app).get(`/api/music/albums/${id}/guide`)).body).toBeNull();
  });

  it('accepte une fiche signée Claude, refuse une source inconnue ou un texte vide', async () => {
    const id = await insertAlbum();
    expect((await request(app).put(`/api/music/albums/${id}/guide`).send({ text: 'Fiche', source: 'claude' })).body.source).toBe('claude');
    expect((await request(app).put(`/api/music/albums/${id}/guide`).send({ text: 'Fiche', source: 'gpt' })).status).toBe(400);
    expect((await request(app).put(`/api/music/albums/${id}/guide`).send({ text: '   ' })).status).toBe(400);
  });

  it('répond 404 pour un album inconnu', async () => {
    expect((await request(app).get('/api/music/albums/99999999/guide')).status).toBe(404);
  });

  it('répond 503 quand le LLM local ne répond pas', async () => {
    const id = await insertAlbum();
    mockSources();
    jest.spyOn(axios, 'post').mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { isAxiosError: true, request: {}, code: 'ECONNREFUSED' }));
    expect((await request(app).post(`/api/music/albums/${id}/guide/generate`)).status).toBe(503);
  });
});

describe('fiche écrite par le LLM local', () => {
  it('rédige avec les plages et durées calculées, vérifie, puis corrige', async () => {
    const id = await insertAlbum();
    mockSources();
    const post = mockLlm([
      { claim: 'Publiées en 1725', verdict: 'supported', evidence: '' },
      { claim: 'à Amsterdam', verdict: 'unsupported', evidence: '' },
    ]);

    const guide = await albumGuideService.generate(id);

    expect(guide).toMatchObject({ albumId: id, text: FIXED.trim(), source: 'local_llm' });
    const draftAsk = post.mock.calls[0][1] as any;
    expect(draftAsk.messages[1].content).toContain('### Le quattro stagioni (<année de composition>), 10 min — plages 1 à 3');
    expect(draftAsk.messages[1].content).toContain('plage 1 (3:10) : La primavera: I. Allegro');
    expect(draftAsk.messages[1].content).toContain('Gidon Kremer (violin)');
    expect(draftAsk.messages[1].content).toContain('Publiées en 1725 à Amsterdam par Le Cène.');
    expect(draftAsk.messages[1].content).not.toContain('Termine par « ### Votre version »');
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('garde le brouillon quand tout est vérifié, et prend le ton d’une fiche de Claude', async () => {
    const other = await insertAlbum();
    await AlbumGuide.save(other, '### Un autre disque\nLe ton à suivre.', 'claude');
    const id = await insertAlbum();
    mockSources();
    const post = mockLlm([{ claim: 'Publiées en 1725', verdict: 'supported', evidence: '' }]);

    expect((await albumGuideService.generate(id)).text).toBe(DRAFT.trim());
    expect(post).toHaveBeenCalledTimes(2);
    expect((post.mock.calls[0][1] as any).messages[1].content).toContain('Le ton à suivre.');
  });

  it('raconte un album qui a son article plage par plage, avec l’article de chaque chanson qui en a un', async () => {
    const other = await insertAlbum(['pop rock']);
    await AlbumGuide.save(other, '### Classique\nPar œuvre.', 'claude');
    const model = await insertAlbum(['pop rock']);
    await AlbumGuide.save(model, '### So\n**Plage par plage** :\n- **Plage 1** : le ton pop.', 'claude');
    const id = await insertAlbum(['pop rock']);
    mockSources();
    jest.spyOn(albumStoryService, 'getStory').mockResolvedValue({
      ...STORY, works: [], title: 'Le quattro stagioni', url: 'https://en.wikipedia.org/wiki/Album',
      links: [{ lang: 'en', title: 'Album', url: 'https://en.wikipedia.org/wiki/Album' }],
    } as any);
    const findSongs = jest.spyOn(albumStoryService, 'findSongArticles').mockImplementation(async (title: string) =>
      title.startsWith('L’estate') ? [{ lang: 'en', title: 'Summer (song)', url: '' }] : []);
    const post = mockLlm([{ claim: 'Publiées en 1725', verdict: 'supported', evidence: '' }]);

    await albumGuideService.generate(id);

    expect(findSongs).toHaveBeenCalledTimes(3);
    expect(findSongs).toHaveBeenCalledWith('La primavera: I. Allegro', 'Vivaldi', 'Le quattro stagioni');
    const ask = (post.mock.calls[0][1] as any).messages[1].content as string;
    expect(ask).toContain('### Le quattro stagioni (<année de première parution>), 10 min — plages 1 à 3');
    expect(ask).toContain('[Wikipédia en : Summer (song) — plage 3 « L’estate: I. Allegro »]');
    expect(ask).toContain('Plage par plage');
    expect(ask).toContain('le ton pop.');
    expect(ask).not.toContain('Par œuvre.');
    expect(ask).not.toContain('Termine par « ### Votre version »');
  });

  it('refuse d’écrire sans rien sur Wikipedia', async () => {
    const id = await insertAlbum();
    mockSources();
    jest.spyOn(albumStoryService, 'getStory').mockResolvedValue({ ...STORY, found: false, works: [] } as any);
    await expect(albumGuideService.generate(id)).rejects.toThrow('Wikipedia has nothing');
  });
});

describe('fiches écrites d’office', () => {
  it('écrit pour un CD ajouté depuis, classique ou non, pas pour un ancien CD ou un CD qui en a déjà une', async () => {
    const generate = jest.spyOn(albumGuideService, 'generate').mockImplementation(async (albumId: number) =>
      AlbumGuide.save(albumId, 'Fiche', 'local_llm', 'test'));
    const before = await AlbumGuide.albumIds();

    const fresh = await insertAlbum(['Baroque']);
    const pop = await insertAlbum(['pop rock']);
    const old = await insertAlbum(['Classical'], '2026-09-01T10:00:00.000Z');
    const done = await insertAlbum(['Classical']);
    await AlbumGuide.save(done, 'Déjà écrite', 'manual');

    const written: number[] = [];
    let next: number | null;
    while ((next = await albumGuideService.writeMissing()) !== null) written.push(next);

    expect(written.filter(id => !before.has(id))).toEqual(expect.arrayContaining([fresh, pop]));
    expect(generate.mock.calls.map(call => call[0])).not.toContain(done);
    expect(generate.mock.calls.map(call => call[0])).not.toContain(old);
    expect(written).toHaveLength(generate.mock.calls.length);
    expect((await AlbumGuide.get(done))!.text).toBe('Déjà écrite');
  });
});
