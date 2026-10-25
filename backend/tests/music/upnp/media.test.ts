import fs from 'fs';
import os from 'os';
import path from 'path';
import type http from 'http';
import { Readable } from 'stream';
import request from 'supertest';
import sharp from 'sharp';
import configManager from '../../../src/config';
import Album from '../../../src/models/album';
import navidromeService from '../../../src/services/navidromeService';
import { mediaTokens, startMediaServer } from '../../../src/services/upnp/media';
import type { AlbumFormatted } from '../../../src/types';
import { albumOf, rig, tracksOf } from './helpers';

describe('the media listener', () => {
  let server: http.Server;
  let token: string;
  let root: string;

  beforeAll(async () => {
    server = await startMediaServer(0, '127.0.0.1');
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'upnp-media-'));
    fs.mkdirSync(path.join(root, 'cd'), { recursive: true });
    await sharp({ create: { width: 1400, height: 1400, channels: 3, background: '#38a' } }).webp().toFile(path.join(root, 'cd', 'big.webp'));
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });

  beforeEach(() => { token = mediaTokens.issue(); });
  afterEach(() => jest.restoreAllMocks());

  const flac = (status: number, headers: Record<string, string>) => jest.spyOn(navidromeService, 'stream').mockImplementation(async () => ({
    status, headers, data: Readable.from([Buffer.from('fLaC')]),
  }));

  it('hands on Navidrome’s bytes and headers as they are, the Range passed on', async () => {
    const stream = flac(206, { 'content-type': 'audio/flac', 'content-range': 'bytes 100-103/5000', 'content-length': '4', 'accept-ranges': 'bytes' });
    const res = await request(server).get(`/upnp/stream/${token}/a7t1.flac`).set('Range', 'bytes=100-103').set('getcontentFeatures.dlna.org', '1');
    expect(res.status).toBe(206);
    expect(res.headers).toMatchObject({
      'content-type': 'audio/flac', 'content-range': 'bytes 100-103/5000', 'content-length': '4', 'accept-ranges': 'bytes',
      'transfermode.dlna.org': 'Streaming', 'contentfeatures.dlna.org': 'DLNA.ORG_OP=01;DLNA.ORG_FLAGS=01700000000000000000000000000000',
    });
    expect(Buffer.from(res.body).toString()).toBe('fLaC');
    expect(stream).toHaveBeenCalledWith('a7t1', 'bytes=100-103');
  });

  it('answers HEAD with the headers alone', async () => {
    flac(200, { 'content-type': 'audio/flac', 'content-length': '5000' });
    const res = await request(server).head(`/upnp/stream/${token}/a7t1.flac`);
    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe('5000');
    expect(res.headers['accept-ranges']).toBe('bytes');
  });

  it('serves nothing without a live token, and nothing but files and covers', async () => {
    const stream = flac(200, { 'content-type': 'audio/flac' });
    expect((await request(server).get(`/upnp/stream/${'0'.repeat(64)}/a7t1.flac`)).status).toBe(404);
    expect((await request(server).get(`/upnp/stream/${token}/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
    expect((await request(server).get('/api/outputs')).status).toBe(404);
    expect((await request(server).get('/api/music/navidrome/stream/a7t1')).status).toBe(404);
    expect((await request(server).post(`/upnp/stream/${token}/a7t1.flac`)).status).toBe(404);
    expect((await request(server).get(`/upnp/other/${token}/a7t1.flac`)).status).toBe(404);
    expect(stream).not.toHaveBeenCalled();

    // A token outlives its session ten minutes, no more.
    mediaTokens.retire(token, Date.now() - 11 * 60 * 1000);
    expect((await request(server).get(`/upnp/stream/${token}/a7t1.flac`)).status).toBe(404);
  });

  it('says 404 for a song Navidrome does not know', async () => {
    flac(200, { 'content-type': 'application/json' });
    expect((await request(server).get(`/upnp/stream/${token}/nope.flac`)).status).toBe(404);
  });

  it('serves an album’s cover as a JPEG of 600px', async () => {
    jest.spyOn(configManager, 'getImagesPath').mockReturnValue(root);
    jest.spyOn(Album, 'findById').mockResolvedValue({ id: 7, cover: '/api/images/cd/big.webp' } as unknown as AlbumFormatted);
    const res = await request(server).get(`/upnp/cover/${token}/7.jpg`).buffer(true).parse((response, done) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => done(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    const meta = await sharp(res.body as Buffer).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: 600, height: 600 });

    jest.spyOn(Album, 'findById').mockResolvedValue({ id: 8, cover: '../../secret.jpg' } as unknown as AlbumFormatted);
    expect((await request(server).get(`/upnp/cover/${token}/8.jpg`)).status).toBe(404);
  });
});

describe('what an appliance is given', () => {
  const saved = { user: process.env.NAVIDROME_USER, password: process.env.NAVIDROME_PASSWORD, url: process.env.NAVIDROME_URL };
  afterAll(() => {
    for (const [name, value] of [['NAVIDROME_USER', saved.user], ['NAVIDROME_PASSWORD', saved.password], ['NAVIDROME_URL', saved.url]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('carries no trace of Navidrome, its address or its credentials', async () => {
    process.env.NAVIDROME_USER = 'nd-user-0451';
    process.env.NAVIDROME_PASSWORD = 'nd-password-0451';
    process.env.NAVIDROME_URL = 'http://navidrome:4533';
    const r = await rig('onkyo');
    try {
      await r.session.playAlbum(albumOf(7), tracksOf(7), 0);
      const sent = JSON.stringify(r.fake.calls);
      expect(sent).toContain('/upnp/stream/');
      for (const secret of ['nd-user-0451', 'nd-password-0451', 'navidrome', '4533', '/rest/', '?u=', '&amp;t=', '&t=']) expect(sent).not.toContain(secret);
    } finally {
      await r.close();
    }
  });
});
