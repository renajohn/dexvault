import type sqlite3 from 'sqlite3';
import { getDatabase } from '../database';
import cacheService from '../services/cacheService';
import type { TrackRow, TrackFormatted, TrackCreateData, TrackPerformer } from '../types';

interface TrackDbRecord {
  album_id: number;
  disc_number: number;
  track_number: number;
  title: string;
  duration_sec: number | null;
  isrc: string | null;
  musicbrainz_recording_id: string | null;
  musicbrainz_track_id: string | null;
  toc: string | null;
  artist: string;
  work: string | null;
  composers: string;
  performers: string;
  medium: string | null;
  created_at: string;
  updated_at: string;
}

const parseList = <T>(text: string | null): T[] => {
  if (!text) return [];
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

export interface SharedTrackRow {
  track_id: number;
  disc_number: number;
  track_number: number;
  track_title: string;
  album_id: number;
}

interface TrackDeleteResult {
  deleted: number | boolean;
}

const Track = {
  createTable: (): Promise<void> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const sql = `
        CREATE TABLE IF NOT EXISTS tracks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          album_id INTEGER NOT NULL,
          disc_number INTEGER NOT NULL DEFAULT 1,
          track_number INTEGER NOT NULL,
          title TEXT NOT NULL,
          duration_sec INTEGER,
          isrc TEXT,
          musicbrainz_recording_id TEXT,
          musicbrainz_track_id TEXT,
          toc TEXT,
          artist TEXT,
          work TEXT,
          composers TEXT,
          performers TEXT,
          medium TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (album_id) REFERENCES albums (id) ON DELETE CASCADE
        )
      `;
      db.run(sql, async (err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          // Credits per track, for the classical albums MusicBrainz details
          // movement by movement. Errors only say the column already exists.
          // And the format of each track's disc, a DVD of a CD + DVD being no audio to rip.
          for (const column of ['artist', 'work', 'composers', 'performers', 'medium']) {
            await new Promise<void>(done => db.run(`ALTER TABLE tracks ADD COLUMN ${column} TEXT`, () => done()));
          }
          // Create indexes for better performance
          const indexPromises: Promise<void>[] = [
            new Promise((resolve, reject) => {
              db.run(`CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON tracks(album_id)`, (err: Error | null) => {
                if (err) reject(err); else resolve();
              });
            }),
            new Promise((resolve, reject) => {
              db.run(`CREATE INDEX IF NOT EXISTS idx_tracks_disc_track ON tracks(album_id, disc_number, track_number)`, (err: Error | null) => {
                if (err) reject(err); else resolve();
              });
            }),
            new Promise((resolve, reject) => {
              db.run(`CREATE INDEX IF NOT EXISTS idx_tracks_isrc ON tracks(isrc)`, (err: Error | null) => {
                if (err) reject(err); else resolve();
              });
            }),
            new Promise((resolve, reject) => {
              db.run(`CREATE INDEX IF NOT EXISTS idx_tracks_musicbrainz_recording ON tracks(musicbrainz_recording_id)`, (err: Error | null) => {
                if (err) reject(err); else resolve();
              });
            })
          ];

          Promise.all(indexPromises)
            .then(() => resolve())
            .catch(reject);
        }
      });
    });
  },

  create: (trackData: TrackCreateData): Promise<TrackDbRecord & { id: number }> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const now = new Date().toISOString();

      const track: TrackDbRecord = {
        album_id: trackData.cdId || trackData.albumId!,
        disc_number: trackData.discNumber || 1,
        track_number: trackData.trackNumber,
        title: trackData.title,
        duration_sec: trackData.durationSec || null,
        isrc: trackData.isrc || null,
        musicbrainz_recording_id: trackData.musicbrainzRecordingId || null,
        musicbrainz_track_id: trackData.musicbrainzTrackId || null,
        toc: trackData.toc || null,
        artist: JSON.stringify(trackData.artist || []),
        work: trackData.work || null,
        composers: JSON.stringify(trackData.composers || []),
        performers: JSON.stringify(trackData.performers || []),
        medium: trackData.medium || null,
        created_at: now,
        updated_at: now
      };

      const sql = `
        INSERT INTO tracks (
          album_id, disc_number, track_number, title, duration_sec,
          isrc, musicbrainz_recording_id, musicbrainz_track_id, toc,
          artist, work, composers, performers, medium,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const params = [
        track.album_id, track.disc_number, track.track_number,
        track.title, track.duration_sec, track.isrc,
        track.musicbrainz_recording_id, track.musicbrainz_track_id,
        track.toc, track.artist, track.work, track.composers, track.performers, track.medium,
        track.created_at, track.updated_at
      ];

      db.run(sql, params, async function(this: sqlite3.RunResult, err: Error | null) {
        if (err) {
          reject(err);
        } else {
          // Invalidate analytics cache when track is created
          await cacheService.invalidateAnalytics();
          resolve({ ...track, id: this.lastID });
        }
      });
    });
  },

  findAll: (): Promise<TrackFormatted[]> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const sql = 'SELECT * FROM tracks ORDER BY album_id, disc_number, track_number';

      db.all(sql, [], (err: Error | null, rows: TrackRow[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows.map(Track.formatRow).filter((r): r is TrackFormatted => r !== null));
        }
      });
    });
  },

  findByCdId: (cdId: number): Promise<TrackFormatted[]> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const sql = `
        SELECT * FROM tracks
        WHERE album_id = ?
        ORDER BY disc_number, track_number
      `;

      db.all(sql, [cdId], (err: Error | null, rows: TrackRow[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows.map(Track.formatRow).filter((r): r is TrackFormatted => r !== null));
        }
      });
    });
  },

  findByCdIdAndDisc: (cdId: number, discNumber: number): Promise<TrackFormatted[]> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const sql = `
        SELECT * FROM tracks
        WHERE album_id = ? AND disc_number = ?
        ORDER BY track_number
      `;

      db.all(sql, [cdId, discNumber], (err: Error | null, rows: TrackRow[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows.map(Track.formatRow).filter((r): r is TrackFormatted => r !== null));
        }
      });
    });
  },

  findByAlbumIds: (albumIds: number[]): Promise<TrackFormatted[]> => {
    return new Promise((resolve, reject) => {
      if (!albumIds || albumIds.length === 0) {
        resolve([]);
        return;
      }

      const db = getDatabase();
      const placeholders = albumIds.map(() => '?').join(',');
      const sql = `
        SELECT * FROM tracks
        WHERE album_id IN (${placeholders})
        ORDER BY album_id, disc_number, track_number
      `;

      db.all(sql, albumIds, (err: Error | null, rows: TrackRow[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows.map(Track.formatRow).filter((r): r is TrackFormatted => r !== null));
        }
      });
    });
  },

  /**
   * The album's tracks that another album of the collection (a CD or a digital album, not a wish nor a mixtape)
   * holds too: the same recording, or the same ISRC when it is on one track only of each album (a CD can give
   * one code to several tracks). One row per track and other album.
   */
  sharedWith: (albumId: number): Promise<SharedTrackRow[]> => {
    return new Promise((resolve, reject) => {
      const uniqueIsrc = (alias: string) =>
        `${alias}.isrc IS NOT NULL AND (SELECT COUNT(*) FROM tracks u WHERE u.album_id = ${alias}.album_id AND u.isrc = ${alias}.isrc) = 1`;
      const sql = `
        SELECT DISTINCT m.id AS track_id, m.disc_number, m.track_number, m.title AS track_title, o.album_id
        FROM tracks m
        JOIN tracks o ON o.album_id != m.album_id AND (
          o.musicbrainz_recording_id = m.musicbrainz_recording_id
          OR (o.isrc = m.isrc AND ${uniqueIsrc('m')} AND ${uniqueIsrc('o')}))
        JOIN albums a ON a.id = o.album_id AND COALESCE(a.title_status, 'owned') IN ('owned', 'digital')
        WHERE m.album_id = ?
        ORDER BY o.album_id, m.disc_number, m.track_number`;
      getDatabase().all(sql, [albumId], (err: Error | null, rows: SharedTrackRow[]) => (err ? reject(err) : resolve(rows)));
    });
  },

  /** Fills in a recording found after the fact, and its ISRC when the track has none; never overwrites a recording. */
  setRecordingId: (id: number, recordingId: string, isrc: string | null = null): Promise<void> => {
    return new Promise((resolve, reject) => {
      getDatabase().run(
        `UPDATE tracks SET musicbrainz_recording_id = ?, isrc = COALESCE(isrc, ?), updated_at = ?
         WHERE id = ? AND musicbrainz_recording_id IS NULL`,
        [recordingId, isrc, new Date().toISOString(), id],
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });
  },

  update: (id: number, trackData: TrackCreateData): Promise<TrackCreateData & { id: number; updated_at: string }> => {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      const now = new Date().toISOString();

      const sql = `
        UPDATE tracks SET
          disc_number = ?, track_number = ?, title = ?, duration_sec = ?,
          isrc = ?, musicbrainz_recording_id = ?, musicbrainz_track_id = ?, toc = ?, updated_at = ?
        WHERE id = ?
      `;

      const params = [
        trackData.discNumber || 1,
        trackData.trackNumber,
        trackData.title,
        trackData.durationSec || null,
        trackData.isrc || null,
        trackData.musicbrainzRecordingId || null,
        trackData.musicbrainzTrackId || null,
        trackData.toc || null,
        now,
        id
      ];

      db.run(sql, params, async function(this: sqlite3.RunResult, err: Error | null) {
        if (err) {
          reject(err);
        } else {
          // Invalidate analytics cache when track is updated
          await cacheService.invalidateAnalytics();
          resolve({ id, ...trackData, updated_at: now });
        }
      });
    });
  },

  deleteByCdId: (cdId: number): Promise<TrackDeleteResult> => {
    return new Promise(async (resolve, reject) => {
      const db = getDatabase();
      const sql = 'DELETE FROM tracks WHERE album_id = ?';

      db.run(sql, [cdId], async function(this: sqlite3.RunResult, err: Error | null) {
        if (err) {
          reject(err);
        } else {
          // Invalidate analytics cache when tracks are deleted
          await cacheService.invalidateAnalytics();
          resolve({ deleted: this.changes });
        }
      });
    });
  },

  delete: (id: number): Promise<{ deleted: boolean }> => {
    return new Promise(async (resolve, reject) => {
      const db = getDatabase();
      const sql = 'DELETE FROM tracks WHERE id = ?';

      db.run(sql, [id], async function(this: sqlite3.RunResult, err: Error | null) {
        if (err) {
          reject(err);
        } else {
          // Invalidate analytics cache when track is deleted
          await cacheService.invalidateAnalytics();
          resolve({ deleted: this.changes > 0 });
        }
      });
    });
  },

  formatRow: (row: TrackRow): TrackFormatted | null => {
    if (!row) return null;

    return {
      id: row.id,
      cdId: row.album_id,  // Keep cdId for backward compatibility in the API
      albumId: row.album_id,
      discNumber: row.disc_number,
      trackNumber: row.track_number,
      title: row.title,
      durationSec: row.duration_sec,
      isrc: row.isrc,
      musicbrainzRecordingId: row.musicbrainz_recording_id,
      musicbrainzTrackId: row.musicbrainz_track_id,
      toc: row.toc,
      artist: parseList<string>(row.artist),
      work: row.work,
      composers: parseList<string>(row.composers),
      performers: parseList<TrackPerformer>(row.performers),
      medium: row.medium ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
};

export default Track;
