import musicService from '../services/musicService';
import { createMixtape, reloadMixtapes } from './mixtapeStore';
import { toast } from '../components/shared/Toast';

/** The name a new mixtape is given, for the owner to type its own over it. */
export const NEW_MIXTAPE_NAME = 'New mixtape';

/** An empty mixtape, its name to be typed; its album id, null when Navidrome made none. */
export const newMixtape = async (): Promise<number | null> => {
  try {
    const album = await musicService.createMixtape(NEW_MIXTAPE_NAME, []);
    await reloadMixtapes();
    return album.id;
  } catch {
    toast('No mixtape made: Navidrome did not answer', { tone: 'danger' });
    return null;
  }
};

/** "Running (copy)": the same songs in the same order; its album id. */
export const duplicateMixtape = (title: string, songIds: string[]): Promise<number | null> =>
  createMixtape(`${title} (copy)`, songIds);
