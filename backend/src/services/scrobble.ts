import navidromeService from './navidromeService';
import listenNextPlayService from './listenNextPlayService';
import type { ListenNextDeparture } from '../models/listenNextPlay';
import logger from '../logger';

/**
 * What a player plays, told to Navidrome under NAVIDROME_USER: `false` as a
 * song starts, so it shows as now playing; `true` once it was listened to,
 * when the album of Listen Next it ends leaves the list. The page's player
 * and an appliance's session both tell it so. Throws when Navidrome refuses.
 */
export const scrobble = async (songId: string, submission: boolean): Promise<{ left: ListenNextDeparture | null }> => {
  await navidromeService.scrobble(songId, submission);
  let left: ListenNextDeparture | null = null;
  if (submission) {
    try {
      left = await listenNextPlayService.noteScrobble(process.env.NAVIDROME_USER || '', songId);
    } catch (error) {
      logger.warn(`Listen Next after song ${songId}: ${(error as Error).message}`);
    }
  }
  return { left };
};

export default { scrobble };
