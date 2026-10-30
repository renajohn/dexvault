import React, { useEffect, useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import {
  BsArrowClockwise, BsBag, BsBookmark, BsBookmarkFill, BsBoxArrowUpRight, BsChevronRight, BsDisc, BsImage, BsMusicNoteList, BsPencil, BsPeople, BsSearch, BsStarFill, BsTag,
  BsTrash, BsWikipedia,
} from 'react-icons/bs';
import musicService, { type AlbumOverlap, type RipTracks } from '../services/musicService';
import scorePiecesService, { type AlbumScore } from '../services/scorePiecesService';
import { setFullPlayer, showAlbum, useAlbumManagement, type ShownAlbum } from '../services/phoneDoor';
import { ripSummary, urlLabel } from '../utils/albumHead';
import { ricardoUrl } from '../utils/digitalLibrary';
import AlbumNotes from './AlbumNotes';
import AlbumStory from './AlbumStory';
import CoverFinder from './CoverFinder';
import ShelfCode from './shared/ShelfCode';
import Button, { LinkButton } from './shared/Button';
import { Loading } from './shared/Spinner';
import { confirm } from './shared/ConfirmDialog';
import toast from './shared/Toast';
import './AlbumInfo.css';

/** The album as DexVault has it, for its info: what its card read (`musicService.getAlbumById`). */
interface AlbumDetails extends ShownAlbum {
  country?: string;
  releaseGroupFirstReleaseDate?: string | number;
  editionNotes?: string;
  genres?: string[];
  producer?: string[];
  engineer?: string[];
  recordingLocation?: string;
  recordingQuality?: string;
  language?: string;
  labels?: string[];
  catalogNumber?: string;
  barcode?: string;
  isrcCodes?: string[];
  annotation?: string;
  musicbrainzReleaseId?: string | null;
  rating?: number | null;
  ratingVotes?: number | null;
  discogsRating?: number | null;
  discogsRatingVotes?: number | null;
  communityRating?: number | null;
  communityVotes?: number;
  backCover?: string | null;
  ownership?: { condition?: string; purchasedAt?: string; priceChf?: number | string; notes?: string };
  urls?: { appleMusic?: string; [key: string]: string | undefined };
  createdAt?: string;
  updatedAt?: string;
}

const CONDITIONS: Record<string, string> = { M: 'Mint', NM: 'Near Mint', 'VG+': 'Very Good Plus', VG: 'Very Good' };

const votesLabel = (votes: number): string => `${votes} vote${votes === 1 ? '' : 's'}`;

/** Each source's votes and rating, for the tooltip: "Discogs: 27 votes → 4.26". */
const communityDetail = (album: AlbumDetails): string => [
  ['Discogs', album.discogsRatingVotes, album.discogsRating] as const,
  ['MusicBrainz', album.ratingVotes, album.rating] as const,
].filter(([, votes, value]) => votes && typeof value === 'number')
  .map(([source, votes, value]) => `${source}: ${votesLabel(votes!)} → ${Number(value!.toFixed(2))}`)
  .join('\n');

/** How many of an album's tracks another holds: "5/11", or "all 11". */
const overlapCount = (other: AlbumOverlap, trackCount: number): string =>
  trackCount > 0 && other.shared >= trackCount ? `all ${trackCount}` : trackCount > 0 ? `${other.shared}/${trackCount}` : String(other.shared);

/** A score's title, short: without the instrument after the dash nor the parentheses, its publisher after. */
const scoreTitle = (score: AlbumScore) =>
  [score.title.replace(/\s*[-–]\s*(?:piano|klavier)\b.*$/i, '').replace(/\s*\(.*?\)\s*/g, ' ').trim(), score.publisher].filter(Boolean).join(', ');

/** A score of the shelf, its card in Scores; a plain link outside the app's router (a test, say). */
const ScoreLink: React.FC<{ id: number; title: string }> = ({ id, title }) => (useInRouterContext()
  ? <Link className="album-info-link" to={`/scores?score=${id}`} onClick={() => setFullPlayer(false)}>{title}</Link>
  : <a className="album-info-link" href={`/scores?score=${id}`}>{title}</a>);

/** A row that unfolds in place: its icon, its words, a count, a chevron turned while open. */
const Row: React.FC<{ id: string; icon: React.ReactNode; words: string; count?: number | null; open: Set<string>; toggle: (id: string) => void; children: React.ReactNode }> = ({ id, icon, words, count, open, toggle, children }) => {
  const shown = open.has(id);
  return (
    <>
      <button type="button" className={`album-info-row${shown ? ' album-info-row--open' : ''}`} aria-expanded={shown} aria-controls={`album-info-${id}`} onClick={() => toggle(id)}>
        <span className="album-info-row__icon" aria-hidden="true">{icon}</span>
        <span className="album-info-row__words">{words}</span>
        {count != null && count > 0 && <span className="album-info-row__count">{count}</span>}
        <BsChevronRight className="album-info-row__chevron" aria-hidden="true" />
      </button>
      {shown && <div id={`album-info-${id}`} className="album-info-fold">{children}</div>}
    </>
  );
};

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <>
    <dt>{label}</dt>
    <dd>{children}</dd>
  </>
);

interface AlbumInfoProps {
  albumId: number;
  /** What the player knows already, to show before the album is read again. */
  known?: ShownAlbum | null;
}

/**
 * The info view of the phone's full screen player, in place of the tracks:
 * everything the album's card said that the player does not (the cover, the
 * title, the artist, the line of format · tracks · length · year, the stars,
 * the guide and the tracks are the player's own). The shelf code and the
 * files first, the edition with the back cover, the genres as filters, the
 * community's rating; then rows that unfold in place (notes, Wikipedia, Also
 * on, scores, credits, owned, codes), the links, and at the foot what the
 * page under the player can do: Edit, Delete.
 */
const AlbumInfo: React.FC<AlbumInfoProps> = ({ albumId, known = null }) => {
  const [album, setAlbum] = useState<AlbumDetails | null>(known && Number(known.id) === albumId ? known as AlbumDetails : null);
  const [rip, setRip] = useState<RipTracks | null | undefined>(undefined);
  const [plays, setPlays] = useState<number | null>(null);
  const [overlaps, setOverlaps] = useState<AlbumOverlap[]>([]);
  const [scores, setScores] = useState<AlbumScore[]>([]);
  const [noteCount, setNoteCount] = useState<number | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [findingBack, setFindingBack] = useState(false);
  const [busy, setBusy] = useState(false);
  const management = useAlbumManagement();

  useEffect(() => {
    let current = true;
    setOpen(new Set());
    setRip(undefined);
    setPlays(null);
    setOverlaps([]);
    setScores([]);
    setNoteCount(null);
    musicService.getAlbumById(albumId).then(found => { if (current) setAlbum(found as AlbumDetails); }).catch(() => undefined);
    musicService.getNavidromeTracks(albumId)
      .then(found => {
        if (!current) return;
        setRip(found);
        if (found?.found && found.album?.id) {
          musicService.getDigitalTracks(found.album.id)
            .then(tracks => { if (current) setPlays(tracks.reduce((sum, track) => sum + track.plays, 0)); })
            .catch(() => undefined);
        }
      })
      .catch(() => { if (current) setRip(null); });
    musicService.getAlbumOverlaps(albumId).then(list => { if (current) setOverlaps(list); }).catch(() => undefined);
    scorePiecesService.ofAlbum(albumId).then(list => { if (current) setScores(Array.isArray(list) ? list : []); }).catch(() => undefined);
    musicService.getAlbumNotes(albumId).then(list => { if (current) setNoteCount(list.length); }).catch(() => undefined);
    return () => { current = false; };
  }, [albumId]);

  if (!album) return <div className="album-info"><Loading>Reading the album…</Loading></div>;

  const toggle = (id: string) => setOpen(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const hasCd = album.titleStatus !== 'digital' && album.titleStatus !== 'wish';
  const wished = album.titleStatus === 'wish';
  const artist = Array.isArray(album.artist) ? album.artist.join(', ') : album.artist || '';
  const trackCount = (album.discs || []).reduce((count, disc) => count + disc.tracks.length, 0);
  const summary = rip?.found ? ripSummary(rip) : null;
  const released = [album.releaseYear, album.country, (album.labels || []).join(', ')].filter(Boolean).join(' · ');
  const firstRelease = album.releaseGroupFirstReleaseDate ? String(album.releaseGroupFirstReleaseDate) : '';
  const original = firstRelease && firstRelease.slice(0, 4) !== String(album.releaseYear ?? '') ? firstRelease : null;
  const ownership = album.ownership || {};
  const owned = [
    ownership.condition ? CONDITIONS[ownership.condition] || ownership.condition : null,
    ownership.purchasedAt ? `bought ${new Date(ownership.purchasedAt).toLocaleDateString()}` : null,
    ownership.priceChf ? `CHF ${ownership.priceChf}` : null,
  ].filter(Boolean).join(' · ');
  const added = album.createdAt ? new Date(album.createdAt).toLocaleDateString() : null;
  const updated = album.updatedAt ? new Date(album.updatedAt).toLocaleDateString() : null;
  const links = Object.entries(album.urls || {}).filter((entry): entry is [string, string] => Boolean(entry[1]));
  const hasCredits = Boolean((album.producer && album.producer.length) || (album.engineer && album.engineer.length) || album.recordingLocation || album.language || album.recordingQuality);
  const hasCodes = Boolean((album.isrcCodes && album.isrcCodes.length) || album.musicbrainzReleaseId || album.annotation);
  const backCover = musicService.getImageUrl(album.backCover ?? null);

  /** The grid filtered by a word of the album: the full screen goes back to the pill under it. */
  const filter = (predicate: string) => {
    if (!management?.search) return;
    setFullPlayer(false);
    management.search(predicate);
  };

  const refreshCommunity = async () => {
    setRefreshing(true);
    try {
      if (album.musicbrainzReleaseId) await musicService.refreshFromMusicBrainz(album.id);
      const fresh = await musicService.refreshCommunityRating(album.id) as Partial<AlbumDetails>;
      setAlbum(current => current && { ...current, ...fresh });
    } catch (error) {
      toast((error as Error).message, { tone: 'danger' });
    } finally {
      setRefreshing(false);
    }
  };

  /** Done by the page under the player, the full screen going back to the pill: the page's dialogs stand under it. */
  const leave = (then: () => void) => { setFullPlayer(false); then(); };
  const askDelete = async () => {
    if (!management?.delete) return;
    if (!await confirm({ title: `Delete “${album.title}”?`, message: 'It leaves the collection. This cannot be undone.', confirmLabel: 'Delete', danger: true })) return;
    setBusy(true);
    try {
      await management.delete(Number(album.id));
      setFullPlayer(false);
    } catch (error) {
      toast(`Could not delete the album: ${(error as Error).message}`, { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  const toggleWish = async () => {
    if (!management?.wish) return;
    setBusy(true);
    try {
      await management.wish(Number(album.id));
      setAlbum(current => current && { ...current, titleStatus: wished ? 'digital' : 'wish' });
    } catch (error) {
      toast(`The wish list was not changed: ${(error as Error).message}`, { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const ripLine = rip === undefined ? <span className="album-info-muted">Reading Navidrome…</span>
    : rip === null ? <span className="album-info-muted">Could not read Navidrome.</span>
    : !summary ? <span className="album-info-muted">{hasCd ? 'Not ripped yet.' : 'No files yet.'}</span>
    : (
      <>
        <span className={summary.state === 'lossless' ? 'album-info-lossless' : 'album-info-lossy'}>{summary.state === 'lossless' ? 'Lossless' : 'Lossy'}</span>
        <span className="album-info-muted">
          {trackCount > 0 ? ` · ${summary.files} of ${trackCount} tracks` : ` · ${summary.files} tracks`}
          {' · '}{summary.format}
          {plays != null && plays > 0 && ` · ${plays} play${plays === 1 ? '' : 's'} in 90 days`}
        </span>
        {summary.state === 'lossy' && hasCd && <span className="album-info-lossy"> · rip the CD again</span>}
      </>
    );

  return (
    <div className="album-info">
      {/* The community's rating where the stars stand over the tracks: one glance to compare. */}
      {(album.musicbrainzReleaseId || album.urls?.discogs) && (
        <div className="album-info-community">
          {typeof album.communityRating === 'number' ? (
            <span title={communityDetail(album)}>
              <span className="album-info-community__value"><BsStarFill aria-hidden="true" /> {album.communityRating.toFixed(1)}</span>
              <span className="album-info-muted"> / 5 · {votesLabel(album.communityVotes ?? 0)}</span>
            </span>
          ) : (
            <span className="album-info-muted" title={communityDetail(album) || undefined}>
              {album.communityVotes ? `Too few votes (${album.communityVotes})` : 'No community rating'}
            </span>
          )}
          <button type="button" className="album-info-refresh" onClick={refreshCommunity} disabled={refreshing} aria-label="Refresh the community rating" title="Reread MusicBrainz and Discogs">
            <BsArrowClockwise aria-hidden="true" className={refreshing ? 'album-info-spinning' : undefined} />
          </button>
        </div>
      )}

      {/* No CD: what to do about it, first. */}
      {!hasCd && (
        <section className="album-info-section album-info-buy">
          <h5>{wished ? 'Wished' : 'To buy'}</h5>
          <div className="album-info-line">
            {wished ? <strong><BsBookmarkFill aria-hidden="true" /> On your wish list</strong> : <strong><BsBag aria-hidden="true" /> No CD on the shelf</strong>}
            {album.titleStatus === 'digital' && <span className="album-info-muted"> · the files only, in Navidrome</span>}
          </div>
          <div className="album-info-buy__actions">
            {management?.wish && (
              <Button size="sm" active={wished} icon={wished ? <BsBookmarkFill /> : <BsBookmark />} onClick={toggleWish} loading={busy}>
                {wished ? 'Wished' : 'Add to wish list'}
              </Button>
            )}
            <LinkButton size="sm" icon={<BsSearch />} href={ricardoUrl({ artist, name: album.title })} title="Search the CD on Ricardo">Ricardo</LinkButton>
            {management?.bought && <Button size="sm" icon={<BsDisc />} onClick={() => leave(() => management.bought!(Number(album.id)))}>I bought the CD</Button>}
            {management?.dismiss && !wished && (
              <Button variant="quiet" size="sm" onClick={() => leave(() => management.dismiss!(Number(album.id), true))}>Not interested</Button>
            )}
          </div>
        </section>
      )}

      <section className="album-info-section">
        <h5>{hasCd ? 'Files and CD' : 'Files'}</h5>
        {hasCd && <div className="album-info-shelf"><ShelfCode kind="album" id={album.id} variant="inline" /></div>}
        <div className="album-info-line">{ripLine}</div>
      </section>

      <section className="album-info-section">
        <h5>Edition</h5>
        <div className="album-info-edition">
          <div className="album-info-edition__words">
            {(released || original) && (
              <div className="album-info-line">
                {released}
                {original && <span className="album-info-muted">{released ? ' · ' : ''}first {original}</span>}
              </div>
            )}
            {(album.catalogNumber || album.barcode) && (
              <div className="album-info-line album-info-codes">
                {album.catalogNumber && <code>{album.catalogNumber}</code>}
                {album.barcode && <code>{album.barcode}</code>}
              </div>
            )}
            {album.editionNotes && <div className="album-info-line album-info-muted album-info-note">{album.editionNotes}</div>}
            {!released && !original && !album.catalogNumber && !album.barcode && !album.editionNotes && <div className="album-info-line album-info-muted">Nothing known of the edition.</div>}
          </div>
          {backCover && <img className="album-info-back" src={backCover} alt={`${album.title} back cover`} />}
        </div>
        {!backCover && management?.coverChange && hasCd && (
          <Button variant="quiet" size="sm" icon={<BsImage />} className="album-info-find-back" onClick={() => setFindingBack(true)}>Find the back…</Button>
        )}
      </section>

      {album.genres && album.genres.length > 0 && (
        <section className="album-info-section">
          <h5>Genres</h5>
          <div className="album-info-chips">
            {album.genres.map(genre => (
              <button key={genre} type="button" className="album-info-chip" disabled={!management?.search} onClick={() => filter(`genre:"${genre}"`)}>{genre}</button>
            ))}
          </div>
        </section>
      )}

      <section className="album-info-section album-info-rows">
        {/* No note yet: the row is the invitation to write the first. */}
        <Row id="notes" icon={<BsPencil />} words={noteCount === 0 ? 'Write a listening note…' : 'Listening notes'} count={noteCount} open={open} toggle={toggle}>
          <AlbumNotes albumId={Number(album.id)} writing onCount={setNoteCount} />
        </Row>
        <Row id="story" icon={<BsWikipedia />} words="On Wikipedia" open={open} toggle={toggle}>
          <AlbumStory albumId={album.id} open />
        </Row>
        {overlaps.length > 0 && (
          <Row id="also" icon={<BsDisc />} words="Also on" count={overlaps.length} open={open} toggle={toggle}>
            <ul className="album-info-list">
              {overlaps.map(other => {
                const thumb = musicService.getImageUrl(other.cover);
                return (
                  <li key={other.id}>
                    <button type="button" className="album-info-also" onClick={() => {
                      musicService.getAlbumById(other.id).then(details => showAlbum(details as ShownAlbum, other.titleStatus === 'digital' ? 'info' : 'tracks')).catch(() => undefined);
                    }}>
                      {thumb ? <img className="album-info-also__cover" src={thumb} alt="" /> : <span className="album-info-also__cover album-info-also__cover--none"><BsDisc aria-hidden="true" /></span>}
                      <span className="album-info-also__words">
                        <span className="album-info-also__title">{other.title}</span>
                        <span className="album-info-muted">
                          {other.titleStatus === 'digital' ? 'digital' : other.format || 'CD'} · {other.trackCount} tracks · {overlapCount(other, trackCount)} of this album's
                        </span>
                      </span>
                      <BsChevronRight aria-hidden="true" className="album-info-also__chevron" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </Row>
        )}
        {scores.length > 0 && (
          <Row id="scores" icon={<BsMusicNoteList />} words="Scores" count={scores.length} open={open} toggle={toggle}>
            <ul className="album-info-list">
              {scores.map(score => <li key={score.id} className="album-info-score"><ScoreLink id={score.id} title={scoreTitle(score)} /></li>)}
            </ul>
          </Row>
        )}
        {hasCredits && (
          <Row id="credits" icon={<BsPeople />} words="Credits" open={open} toggle={toggle}>
            <dl className="album-info-facts">
              {album.producer && album.producer.length > 0 && <Fact label={album.producer.length > 1 ? 'Producers' : 'Producer'}>{album.producer.join(', ')}</Fact>}
              {album.engineer && album.engineer.length > 0 && <Fact label={album.engineer.length > 1 ? 'Engineers' : 'Engineer'}>{album.engineer.join(', ')}</Fact>}
              {album.recordingLocation && <Fact label="Recorded at">{album.recordingLocation}</Fact>}
              {album.recordingQuality && <Fact label="Quality">{album.recordingQuality}</Fact>}
              {album.language && <Fact label="Language">{album.language.toUpperCase()}</Fact>}
            </dl>
          </Row>
        )}
        {(hasCd || added) && (
          <Row id="owned" icon={<BsBag />} words={hasCd ? 'Owned' : 'In DexVault'} open={open} toggle={toggle}>
            {owned && <p>{owned}</p>}
            {ownership.notes && <p className="album-info-muted">{ownership.notes}</p>}
            {added && <p className="album-info-muted">added {added}{updated && updated !== added && ` · updated ${updated}`}</p>}
          </Row>
        )}
        {hasCodes && (
          <Row id="codes" icon={<BsTag />} words="Codes" open={open} toggle={toggle}>
            <dl className="album-info-facts">
              {album.isrcCodes && album.isrcCodes.length > 0 && (
                <Fact label="ISRC">
                  {album.isrcCodes.length > 3 && !open.has('isrc') ? (
                    <button type="button" className="album-info-clamp" title="Show every code" onClick={() => toggle('isrc')}>
                      <code>{album.isrcCodes[0]}</code> … <code>{album.isrcCodes[album.isrcCodes.length - 1]}</code>
                      <span className="album-info-muted"> ({album.isrcCodes.length}, one per track)</span>
                    </button>
                  ) : <span className="album-info-codes">{album.isrcCodes.map(code => <code key={code}>{code}</code>)}</span>}
                </Fact>
              )}
              {album.musicbrainzReleaseId && <Fact label="MusicBrainz"><code>{album.musicbrainzReleaseId}</code></Fact>}
              {album.annotation && <Fact label="Album notes"><span className="album-info-note">{album.annotation}</span></Fact>}
            </dl>
          </Row>
        )}
      </section>

      {(album.musicbrainzReleaseId || links.length > 0) && (
        <section className="album-info-section">
          <h5>Links</h5>
          <div className="album-info-links">
            {album.musicbrainzReleaseId && (
              <a className="album-info-link" href={`https://musicbrainz.org/release/${album.musicbrainzReleaseId}`} target="_blank" rel="noopener noreferrer">
                MusicBrainz <BsBoxArrowUpRight aria-hidden="true" />
              </a>
            )}
            {links.map(([key, url]) => (
              <a key={key} className="album-info-link" href={url} target="_blank" rel="noopener noreferrer">{urlLabel(key)} <BsBoxArrowUpRight aria-hidden="true" /></a>
            ))}
          </div>
        </section>
      )}

      {/* A digital album is Navidrome's: it goes when its files go, and it has nothing of a CD to edit. */}
      {album.titleStatus !== 'digital' && (management?.edit || management?.delete) && (
        <div className="album-info-manage">
          {management.edit && <Button icon={<BsPencil />} onClick={() => leave(() => management.edit!(Number(album.id)))}>Edit…</Button>}
          {management.delete && <Button variant="danger" icon={<BsTrash />} onClick={askDelete} loading={busy}>Delete</Button>}
        </div>
      )}

      {findingBack && (
        <CoverFinder albumId={album.id} side="back" title={album.title} artist={album.artist ?? ''} zIndex={12000} backdropClassName="over-player-backdrop"
          onClose={() => setFindingBack(false)}
          onFound={coverPath => {
            setFindingBack(false);
            setAlbum(current => current && { ...current, backCover: coverPath });
            management?.coverChange?.(Number(album.id), 'back', coverPath);
            toast('Back cover found', { tone: 'success' });
          }} />
      )}
    </div>
  );
};

export default AlbumInfo;
