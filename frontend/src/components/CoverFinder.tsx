import React, { useEffect, useMemo, useState } from 'react';
import { BsDisc } from 'react-icons/bs';
import Dialog from './shared/Dialog';
import Button from './shared/Button';
import Notice from './shared/Notice';
import { Loading } from './shared/Spinner';
import CoverChoices, { coverKey, largestFirst, useImageDimensions, type CoverChoice } from './CoverChoices';
import CoverModal from './CoverModal';
import musicService from '../services/musicService';

interface CoverFinderProps {
  albumId: number | string;
  side: 'front' | 'back';
  title: string;
  artist: string | string[];
  onClose: () => void;
  /** The cover chosen is kept: its path. */
  onFound: (coverPath: string) => void;
  /** Over the phone's full screen player: 12000 and its backdrop. */
  zIndex?: number;
  backdropClassName?: string;
}

/**
 * For an album missing a side: the covers its other editions, Discogs and
 * Deezer hold, to choose from as when a CD is added. This edition's own
 * comes first, then the largest; the first is chosen until another is.
 */
const CoverFinder: React.FC<CoverFinderProps> = ({ albumId, side, title, artist, onClose, onFound, zIndex = 10150, backdropClassName }) => {
  const [covers, setCovers] = useState<CoverChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [zoomed, setZoomed] = useState<CoverChoice | null>(null);
  const sideName = side === 'front' ? 'Front' : 'Back';

  useEffect(() => {
    let current = true;
    musicService.getCoverCandidates(albumId, side)
      .then(found => {
        if (!current) return;
        setCovers(found.map(candidate => ({
          url: candidate.thumbnail,
          fullUrl: candidate.url,
          type: side,
          country: candidate.country,
          year: candidate.year,
          catalogNumber: candidate.catalogNumber,
          source: candidate.source,
        })));
      })
      .catch((e: Error) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [albumId, side]);

  const dimensions = useImageDimensions(covers ?? []);
  // This edition's own first, then the largest; an image that would not load
  // measures 0×0: it goes last, and is never chosen first.
  const sorted = useMemo(() => {
    const bySize = largestFirst(covers ?? [], dimensions);
    return [...bySize.filter(cover => cover.source === 'This edition'), ...bySize.filter(cover => cover.source !== 'This edition')];
  }, [covers, dimensions]);
  const selected = chosen ?? (sorted.length > 0 && dimensions[coverKey(sorted[0])]?.width ? coverKey(sorted[0]) : null);

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      onFound(await musicService.useCoverCandidate(albumId, side, selected));
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Dialog show onClose={onClose} size="lg" scrollable zIndex={zIndex} backdropClassName={backdropClassName} icon={<BsDisc />}
      title={side === 'front' ? 'Choose a cover' : 'Choose a back cover'}
      aside={<span className="dialog-head__meta">{title}</span>}>
      <Dialog.Body>
        {covers === null && !error && <Loading>Looking through its other editions, Discogs and Deezer…</Loading>}
        {covers?.length === 0 && (
          <Notice>None of its editions on MusicBrainz, nor Discogs{side === 'front' ? ', nor Deezer,' : ''} has a {side === 'front' ? 'cover' : 'back cover'} for this album.</Notice>
        )}
        {sorted.length > 0 && (
          <CoverChoices
            label={`${sorted.length} ${side === 'front' ? 'cover' : 'back cover'}${sorted.length === 1 ? '' : 's'} found:`}
            side={sideName}
            covers={sorted}
            selected={selected}
            onSelect={cover => setChosen(coverKey(cover))}
            onZoom={setZoomed}
            dimensions={dimensions}
          />
        )}
        {error && <Notice tone="danger" className="mt-2">{error}</Notice>}
      </Dialog.Body>
      <Dialog.Footer>
        <span style={{ flex: 1 }} />
        <Button variant="quiet" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={!selected} loading={saving}>
          {side === 'front' ? 'Use this cover' : 'Use this back cover'}
        </Button>
      </Dialog.Footer>
      {zoomed && (
        <CoverModal isOpen onClose={() => setZoomed(null)} coverUrl={coverKey(zoomed)} title={title} artist={artist} coverType={sideName} />
      )}
    </Dialog>
  );
};

export default CoverFinder;
