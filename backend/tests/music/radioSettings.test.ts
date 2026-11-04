import request from 'supertest';
import app from '../../index';
import RadioSettings from '../../src/models/radioSettings';

const pool = { stars: 3.5, hearts: true, popular: false, genre: 'other', wholeWorks: false };

beforeEach(() => RadioSettings.clear());

describe("the radio's settings, the same on every device", () => {
  it('none until a device saves some, then the last saved for every device', async () => {
    expect((await request(app).get('/api/radio/settings').expect(200)).body).toEqual({ settings: null, updatedAt: null });

    const laptop = {
      prompt: 'quelque chose de upbeat pour courir',
      recent: ['quelque chose de upbeat pour courir', 'calme pour le soir'],
      pool,
      criteria: { energyMin: 6, tempos: ['fast'], moods: ['upbeat', 'driving'], styles: ['rock'] },
    };
    const saved = (await request(app).put('/api/radio/settings').send(laptop).expect(200)).body;
    expect(saved.settings).toMatchObject({ prompt: laptop.prompt, recent: laptop.recent, pool });
    expect(saved.settings.criteria).toMatchObject({ energyMin: 6, tempos: ['fast'], moods: ['upbeat', 'driving'], styles: ['rock'] });
    expect(typeof saved.updatedAt).toBe('string');

    // The phone reads what the laptop saved.
    const phone = (await request(app).get('/api/radio/settings').expect(200)).body;
    expect(phone).toEqual(saved);

    // Then the phone changes the prompt: the laptop reads it next.
    await request(app).put('/api/radio/settings').send({ ...laptop, prompt: 'calme pour le soir', criteria: null }).expect(200);
    const again = (await request(app).get('/api/radio/settings').expect(200)).body;
    expect(again.settings).toMatchObject({ prompt: 'calme pour le soir', criteria: null });
    expect(again.updatedAt >= saved.updatedAt).toBe(true);
  });

  it('keeps six recent prompts at most, each once, trimmed', async () => {
    const recent = [' a ', 'b', 'a', 'c', 'd', 'e', 'f', 'g'];
    const body = (await request(app).put('/api/radio/settings').send({ prompt: 'a', recent, pool }).expect(200)).body;
    expect(body.settings.recent).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('refuses what is not settings', async () => {
    await request(app).put('/api/radio/settings').send({ recent: [], pool }).expect(400);
    await request(app).put('/api/radio/settings').send({ prompt: 'x', recent: 'x', pool }).expect(400);
    await request(app).put('/api/radio/settings').send({ prompt: 'x', recent: [], pool: { ...pool, stars: 7 } }).expect(400);
    await request(app).put('/api/radio/settings').send({ prompt: 'x'.repeat(501), recent: [], pool }).expect(400);
    await request(app).put('/api/radio/settings').send({ prompt: 'x', recent: [], pool, criteria: 'loud' }).expect(400);
    expect((await request(app).get('/api/radio/settings').expect(200)).body.settings).toBeNull();
  });
});
