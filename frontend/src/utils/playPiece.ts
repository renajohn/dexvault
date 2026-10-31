import type { PieceRecording, ScorePiece } from '../services/scorePiecesService';
import { player, usePlayer } from '../services/player';
import { loadPlayable } from './playAlbum';
import toast from '../components/shared/Toast';

/**
 * Plays recordings of an album, in their order, from the one asked: the
 * album's rip in Navidrome holds the files. False when none of them is ripped.
 */
export const playRecordings = async (recordings: PieceRecording[], start = 0): Promise<boolean> => {
  if (!recordings.length) return false;
  const { album, tracks } = await loadPlayable(recordings[0].albumId);
  const wanted = recordings.map(r => tracks.find(track => track.disc === r.disc && track.no === r.no)).filter(Boolean) as typeof tracks;
  if (!wanted.length) return false;
  const first = tracks.find(track => track.disc === recordings[start]?.disc && track.no === recordings[start]?.no);
  player.playAlbum(album, wanted, Math.max(0, first ? wanted.indexOf(first) : 0));
  return true;
};

export const play = (recordings: PieceRecording[], start = 0) => {
  playRecordings(recordings, start)
    .then(played => { if (!played) toast('Not in Navidrome: this album has no rip to play', { tone: 'warning' }); })
    .catch(error => toast((error as Error).message, { tone: 'danger' }));
};

/** Whether this recording is the track the player is on. */
export const usePlaying = () => usePlayer(state => (state.album?.id && state.tracks[state.index]
  ? `${state.album.id}:${state.tracks[state.index].disc}:${state.tracks[state.index].no}` : null));
export const keyOf = (r: PieceRecording) => `${r.albumId}:${r.disc}:${r.no}`;

/** A piece of one movement: the first track of each album playing it. */
export const recordingsOfSingle = (piece: ScorePiece): PieceRecording[] =>
  piece.albums.flatMap(album => piece.whole.filter(r => r.albumId === album.albumId).slice(0, 1));

/** The recording a row plays: the chosen album's, else its first. */
export const mainOf = (recordings: PieceRecording[], chosenAlbumId: number | null) =>
  recordings.find(r => r.albumId === chosenAlbumId) || recordings[0] || null;

/** What plays a piece, or a part of its set: the recording chosen for the piece, else the first. */
export const recordingOf = (piece: ScorePiece, partWorkId: string | null): PieceRecording | null => {
  const chosen = piece.albums.find(album => album.albumId === piece.preferredAlbumId) || piece.albums[0];
  const recordings = partWorkId ? piece.parts.find(part => part.workId === partWorkId)?.recordings || [] : recordingsOfSingle(piece).length ? recordingsOfSingle(piece) : piece.whole;
  return mainOf(recordings, chosen?.albumId ?? null);
};
