import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import app from '../../index';
import configManager from '../../src/config';
import navidromeService from '../../src/services/navidromeService';

let data: string;
let fakeFfmpeg: string;
let args: string;

beforeAll(() => {
  // An ffmpeg of the test's own: it answers -version, swallows the file, notes what it was asked and writes its last argument.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexvault-ffmpeg-'));
  fakeFfmpeg = path.join(dir, 'ffmpeg');
  args = path.join(dir, 'args');
  fs.writeFileSync(fakeFfmpeg, `#!/bin/sh
if [ "$1" = "-version" ]; then exit 0; fi
echo "$@" > "${args}"
cat > /dev/null
for last; do :; done
printf 'm4a-bytes-0123456789' > "$last"
`, { mode: 0o755 });
  process.env.FFMPEG_PATH = fakeFfmpeg;
});

beforeEach(() => {
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'dexvault-data-'));
  jest.spyOn(configManager, 'getDataPath').mockReturnValue(data);
  jest.spyOn(navidromeService, 'isConfigured').mockReturnValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(data, { recursive: true, force: true });
});

afterAll(() => { delete process.env.FFMPEG_PATH; });

const flac = () => jest.spyOn(navidromeService, 'stream').mockImplementation(async () => ({
  status: 200, headers: { 'content-type': 'audio/flac' }, data: Readable.from([Buffer.from('fLaC')]),
}));

describe('a song made lighter for a weak network', () => {
  it('is encoded once from the FLAC in AAC 256, then kept and served as a file, every range answered', async () => {
    const stream = flac();

    expect((await request(app).post('/api/music/navidrome/light/abc123')).body).toEqual({ ready: true });
    // Asked of Navidrome as the file lies on disk, the encoding DexVault's own.
    expect(stream).toHaveBeenCalledWith('abc123');
    expect(fs.readFileSync(args, 'utf8')).toContain('-c:a aac -b:a 256k -movflags +faststart -f mp4');
    expect(fs.existsSync(path.join(data, 'transcodes', 'abc123-aac256.m4a'))).toBe(true);

    const whole = await request(app).get('/api/music/navidrome/light/abc123');
    expect(whole.status).toBe(200);
    expect(whole.headers['content-type']).toBe('audio/mp4');
    expect(whole.headers['accept-ranges']).toBe('bytes');

    const part = await request(app).get('/api/music/navidrome/light/abc123').set('Range', 'bytes=4-8');
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe('bytes 4-8/20');
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('refuses what is not a song id, and says a song Navidrome does not know', async () => {
    expect((await request(app).get('/api/music/navidrome/light/..%2Fetc')).status).toBe(400);
    jest.spyOn(navidromeService, 'stream').mockResolvedValue({
      status: 200, headers: { 'content-type': 'application/json' }, data: Readable.from(['{}']),
    });
    expect((await request(app).post('/api/music/navidrome/light/nope')).status).toBe(502);
    expect(fs.existsSync(path.join(data, 'transcodes', 'nope-aac256.m4a'))).toBe(false);
  });

  it('leaves the plain stream, the one the appliances are given, as the file lies on disk', async () => {
    const stream = flac();
    await request(app).get('/api/music/navidrome/stream/abc123').expect(200);
    expect(stream).toHaveBeenCalledWith('abc123', undefined);
  });
});
