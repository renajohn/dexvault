import React, { useEffect, useMemo, useState } from 'react';
import { Form } from 'react-bootstrap';
import { BsBoxArrowUpRight, BsDownload } from 'react-icons/bs';
import bookSectionsService, { MutopiaTarget, ScoreFile } from '../services/bookSectionsService';
import Button from './shared/Button';
import Dialog from './shared/Dialog';
import { Loading } from './shared/Spinner';
import toast from './shared/Toast';
import './MutopiaPieces.css';

type Candidate = MutopiaTarget['candidates'][number];
const keyOf = (target: MutopiaTarget, candidate: Candidate) => `${target.pieceId}:${target.partWorkId || ''}:${candidate.id}`;

/**
 * The Mutopia Project's pieces for a score's pieces, or the parts it holds of
 * a set: engraved anew, free to print, downloaded without a check. Those
 * checked are fetched into one PDF, in the score's order, each piece marked
 * at its pages, so it opens, prints and plays by its piece at once.
 */
const MutopiaPieces: React.FC<{
  scoreId: number;
  onClose: () => void;
  onAdded: (files: ScoreFile[]) => void;
}> = ({ scoreId, onClose, onAdded }) => {
  const [found, setFound] = useState<{ composer: { code: string; name: string } | null; targets: MutopiaTarget[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    let current = true;
    bookSectionsService.mutopia(scoreId)
      .then(result => {
        if (!current) return;
        setFound(result);
        setPicked(new Set(result.targets.flatMap(target => target.candidates.filter(c => c.checked).map(c => keyOf(target, c)))));
      })
      .catch(error => { if (current) setFailed((error as Error).message); });
    return () => { current = false; };
  }, [scoreId]);

  // By piece of the score, with how many of its parts Mutopia lacks.
  const pieces = useMemo(() => {
    const byPiece = new Map<number, { title: string; targets: MutopiaTarget[]; missing: number }>();
    for (const target of found?.targets || []) {
      const piece = byPiece.get(target.pieceId) || { title: target.piece, targets: [], missing: 0 };
      if (target.candidates.length) piece.targets.push(target); else piece.missing += 1;
      byPiece.set(target.pieceId, piece);
    }
    return [...byPiece.values()].filter(piece => piece.targets.length);
  }, [found]);
  const missing = useMemo(() => {
    const byPiece = new Map<number, boolean>();
    for (const target of found?.targets || []) byPiece.set(target.pieceId, (byPiece.get(target.pieceId) ?? false) || target.candidates.length > 0);
    return [...byPiece.values()].filter(has => !has).length;
  }, [found]);

  const toggle = (key: string) => setPicked(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const picks = (found?.targets || []).flatMap(target => target.candidates
    .filter(candidate => picked.has(keyOf(target, candidate)))
    .map(candidate => ({ pieceId: target.pieceId, partWorkId: target.partWorkId, pdf: candidate.pdf })));

  const fetchThem = async () => {
    setFetching(true);
    try {
      const files = await bookSectionsService.fetchMutopia(scoreId, picks);
      toast(`${picks.length} ${picks.length === 1 ? 'piece' : 'pieces'} from Mutopia, in one PDF, each marked at its pages`, { tone: 'success' });
      onAdded(files);
      onClose();
    } catch (error) {
      toast((error as Error).message, { tone: 'danger' });
    } finally {
      setFetching(false);
    }
  };

  const composerUrl = found?.composer ? `https://www.mutopiaproject.org/cgibin/make-table.cgi?Composer=${found.composer.code}` : 'https://www.mutopiaproject.org/browse.html';

  return (
    <Dialog show onClose={onClose} size="lg" title="Its pieces on Mutopia" className="mutopia-pieces">
      <Dialog.Body>
        {failed ? <p className="mutopia-pieces__empty">{failed}</p>
          : !found ? <Loading>Reading the composer’s pieces on Mutopia…</Loading>
            : !found.composer ? <p className="mutopia-pieces__empty">Mutopia has no piece of its composer.</p>
              : !pieces.length ? <p className="mutopia-pieces__empty">Mutopia has none of its pieces by {found.composer.name}{found.targets.length ? '' : ': its pieces must be known first'}.</p>
                : (
                  <>
                    <p className="mutopia-pieces__hint">
                      Engraved anew with LilyPond, free to print. Those checked come in one PDF, each piece marked at its pages.
                      {missing > 0 && ` ${missing} of its pieces ${missing === 1 ? 'is' : 'are'} not on Mutopia.`}
                    </p>
                    {pieces.map(piece => (
                      <section key={piece.title} className="mutopia-pieces__piece">
                        <h5>{piece.title}</h5>
                        {piece.targets.map(target => target.candidates.map(candidate => {
                          const key = keyOf(target, candidate);
                          return (
                            <div key={key} className="mutopia-piece">
                              <Form.Check type="checkbox" id={`mutopia-${key}`} checked={picked.has(key)} onChange={() => toggle(key)}
                                label={<span className="mutopia-piece__name">{target.partWorkId ? target.name : 'The whole'}</span>} />
                              <div className="mutopia-piece__text">
                                <div className="mutopia-piece__meta">
                                  {[candidate.title, candidate.opus, candidate.instrument, candidate.source, candidate.licence].filter(Boolean).join(' · ')}
                                </div>
                                {candidate.preview && <img className="mutopia-piece__preview" src={candidate.preview} alt="" loading="lazy" />}
                              </div>
                            </div>
                          );
                        }))}
                        {piece.missing > 0 && <p className="mutopia-pieces__missing">{piece.missing} of its parts not on Mutopia</p>}
                      </section>
                    ))}
                  </>
                )}
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="quiet" icon={<BsBoxArrowUpRight />} onClick={() => window.open(composerUrl, '_blank', 'noopener')}>
          {found?.composer ? `${found.composer.name} on Mutopia` : 'Mutopia'}
        </Button>
        <Button variant="quiet" onClick={onClose}>Close</Button>
        {pieces.length > 0 && (
          <Button variant="primary" icon={<BsDownload />} loading={fetching} disabled={!picks.length} onClick={fetchThem}>
            {`Fetch ${picks.length} ${picks.length === 1 ? 'piece' : 'pieces'}`}
          </Button>
        )}
      </Dialog.Footer>
    </Dialog>
  );
};

export default MutopiaPieces;
