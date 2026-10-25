import { loadRenderer, type Renderer } from '../../../src/services/upnp/device';
import { OutputSession, type SavedSession, type SessionDeps } from '../../../src/services/upnp/session';
import type { Playable, PlayerAlbum, PlayerTrack } from '../../../src/services/playable';
import type { ListenNextDeparture } from '../../../src/models/listenNextPlay';
import { FakeRenderer, type Kind } from './fakeRenderer';

export const MEDIA_BASE = 'http://dexvault.test:3002';
export const TOKEN = 'f'.repeat(64);

export const albumOf = (id: number, title = `Album ${id}`): PlayerAlbum => ({ id, title, artist: 'Artist', cover: `/api/images/cd/${id}.jpg` });

export const tracksOf = (albumId: number, count = 3, durationSec = 200): PlayerTrack[] =>
  Array.from({ length: count }, (_, i) => ({ songId: `a${albumId}t${i + 1}`, title: `Track ${i + 1}`, disc: 1, no: i + 1, durationSec, suffix: 'flac' }));

/** The address the session gives the appliance for a song. */
export const urlOf = (songId: string, token = TOKEN): string => `${MEDIA_BASE}/upnp/stream/${token}/${songId}.flac`;

export interface Rig {
  fake: FakeRenderer;
  renderer: Renderer;
  session: OutputSession;
  scrobbles: Array<[string, boolean]>;
  events: Array<[string, unknown]>;
  saves: Array<SavedSession | null>;
  deps: SessionDeps;
  /** What scrobbling a song answers: an album leaving Listen Next. */
  departures: Map<string, ListenNextDeparture>;
  /** Plays on for `seconds`, asked where it is every `step` seconds, as the poller would. */
  playFor: (seconds: number, step?: number) => Promise<void>;
  close: () => Promise<void>;
}

/** A session on a fake appliance, its scrobbles, states and saves noted; albums loaded from `albums`. */
export const rig = async (kind: Kind, { albums = new Map<number, Playable>(), saved = null as SavedSession | null, maxVolume = 70, deps = {} as Partial<SessionDeps> } = {}): Promise<Rig> => {
  const fake = await new FakeRenderer(kind).start();
  const renderer = await loadRenderer(fake.location);
  const scrobbles: Array<[string, boolean]> = [];
  const events: Array<[string, unknown]> = [];
  const saves: Array<SavedSession | null> = [];
  const departures = new Map<string, ListenNextDeparture>();
  const full: SessionDeps = {
    renderer: () => renderer,
    mediaBase: MEDIA_BASE,
    name: () => renderer.description.name,
    maxVolume: () => maxVolume,
    load: async albumId => albums.get(albumId) ?? { album: albumOf(albumId), tracks: [] },
    scrobble: async (songId, submission) => {
      scrobbles.push([songId, submission]);
      return { left: submission ? departures.get(songId) ?? null : null };
    },
    issueToken: () => TOKEN,
    save: async state => { saves.push(state); },
    emit: (event, payload) => { events.push([event, payload]); },
    now: () => fake.clock,
    wait: async () => undefined,
    ...deps,
  };
  const session = new OutputSession(renderer.id, full, saved);
  const playFor = async (seconds: number, step = 1) => {
    for (let gone = 0; gone < seconds; gone += step) {
      fake.advance(Math.min(step, seconds - gone));
      await session.tick();
    }
    await session.idle();
  };
  return {
    fake, renderer, session, scrobbles, events, saves, deps: full, departures, playFor,
    close: async () => { session.dispose(); await fake.stop(); },
  };
};
