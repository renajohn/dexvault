import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import app from '../../index';
import configManager from '../../src/config';
import navidromeService from '../../src/services/navidromeService';
import { levelsOf } from '../../src/services/waveformService';

let data: string;
let fakeFfmpeg: string;

beforeAll(() => {
  // An ffmpeg of the test's own: it answers -version, swallows the file and gives 0.1 s of silence then 0.1 s of sound.
  fakeFfmpeg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dexvault-ffmpeg-')), 'ffmpeg');
  fs.writeFileSync(fakeFfmpeg, `#!/bin/sh
if [ "$1" = "-version" ]; then exit 0; fi
cat > /dev/null
"${process.execPath}" -e "const b=Buffer.alloc(3200);for(let i=0;i<1600;i++)b.writeInt16LE(i<800?0:16000,i*2);process.stdout.write(b)"
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

describe('a song’s wave', () => {
  it('reads the level of each slice of 20 ms, the loudest at 255', () => {
    const samples = new Int16Array(480).fill(0, 0, 160).fill(8000, 160, 320).fill(16000, 320);
    expect([...levelsOf(samples)]).toEqual([0, 128, 255]);
  });

  it('is read once from Navidrome through ffmpeg, then kept on the disk', async () => {
    const stream = jest.spyOn(navidromeService, 'stream').mockImplementation(async () => ({
      status: 200, headers: { 'content-type': 'audio/flac' }, data: Readable.from([Buffer.from('fLaC')]),
    }));

    const res = await request(app).get('/api/music/navidrome/waveform/abc123');
    expect(res.status).toBe(200);
    expect(res.body.bin).toBe(0.02);
    expect([...Buffer.from(res.body.levels, 'base64')]).toEqual([0, 0, 0, 0, 0, 255, 255, 255, 255, 255]);
    expect(res.headers['cache-control']).toContain('immutable');
    expect(fs.existsSync(path.join(data, 'waveforms', 'abc123.bin'))).toBe(true);

    await request(app).get('/api/music/navidrome/waveform/abc123').expect(200);
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('refuses what is not a song id', async () => {
    expect((await request(app).get('/api/music/navidrome/waveform/..%2Fetc')).status).toBe(400);
  });
});
