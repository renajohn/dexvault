import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Form } from 'react-bootstrap';
import { BsBoxArrowUpRight, BsDownload } from 'react-icons/bs';
import bookSectionsService, { MutopiaTarget, MutopiaVersion, ScoreFile } from '../services/bookSectionsService';
import Button from './shared/Button';
import Dialog from './shared/Dialog';
import Select from './shared/Select';
import { Loading } from './shared/Spinner';
import toast from './shared/Toast';
import './MutopiaPieces.css';

/** A piece of the score, or a part of a set, Mutopia plays: one line, one choice. */
interface Row { key: string; target: MutopiaTarget }
const keyOf = (target: MutopiaTarget) => `${target.pieceId}:${target.partWorkId || ''}`;

const KEYBOARD = /piano|harpsichord|clavichord|keyboard|cembalo|clavier/i;
/** The instruments as one chooses them for all: harpsichord or piano is the keyboard. */
export const familyOf = (instrument: string | null) => (!instrument ? 'Other' : KEYBOARD.test(instrument) ? 'Keyboard' : /guitar/i.test(instrument) ? 'Guitar' : instrument);

/**
 * A version as offered: its instrument's family (the instrument itself is
 * under it), numbered when another of the family is offered beside it.
 */
const labelOf = (version: MutopiaVersion, versions: MutopiaVersion[]) => {
  const family = familyOf(version.instrument);
  const alike = versions.filter(other => familyOf(other.instrument) === family);
  return alike.length > 1 ? `${family} ${alike.indexOf(version) + 1}` : family;
};

type Tri = 'all' | 'some' | 'none';
const triOf = (rows: Row[], picked: Set<string>): Tri => {
  const count = rows.filter(row => picked.has(row.key)).length;
  return count === 0 ? 'none' : count === rows.length ? 'all' : 'some';
};

/** A box that checks or clears them all, half checked when some are. */
const AllCheck: React.FC<{ id: string; state: Tri; label: React.ReactNode; onChange: (on: boolean) => void }> = ({ id, state, label, onChange }) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = state === 'some'; }, [state]);
  return <Form.Check ref={ref} type="checkbox" id={id} checked={state === 'all'} onChange={() => onChange(state !== 'all')} label={label} />;
};

/**
 * The Mutopia Project's pieces for a score's pieces, or the parts it holds of
 * a set: engraved anew, free to print, downloaded without a check. One line a
 * piece, its version (the keyboard's, a guitar's) to choose when Mutopia has
 * several; all checked or none at once, a run by a shift-click, every line's
 * instrument at once. Those checked are fetched into one PDF, in the score's
 * order, each piece marked at its pages.
 */
const MutopiaPieces: React.FC<{
  scoreId: number;
  onClose: () => void;
  onAdded: (files: ScoreFile[]) => void;
}> = ({ scoreId, onClose, onAdded }) => {
  const [found, setFound] = useState<{ composer: { code: string; name: string } | null; targets: MutopiaTarget[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // The version of each line, by its place among the line's.
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [fetching, setFetching] = useState(false);
  const lastClicked = useRef<number | null>(null);

  useEffect(() => {
    let current = true;
    bookSectionsService.mutopia(scoreId)
      .then(result => {
        if (!current) return;
        setFound(result);
        setPicked(new Set(result.targets.filter(target => target.versions[0]?.checked).map(keyOf)));
      })
      .catch(error => { if (current) setFailed((error as Error).message); });
    return () => { current = false; };
  }, [scoreId]);

  // By piece of the score, with how many of its parts Mutopia lacks.
  const pieces = useMemo(() => {
    const byPiece = new Map<number, { title: string; rows: Row[]; missing: number }>();
    for (const target of found?.targets || []) {
      const piece = byPiece.get(target.pieceId) || { title: target.piece, rows: [], missing: 0 };
      if (target.versions.length) piece.rows.push({ key: keyOf(target), target }); else piece.missing += 1;
      byPiece.set(target.pieceId, piece);
    }
    return [...byPiece.entries()].map(([pieceId, piece]) => ({ pieceId, ...piece })).filter(piece => piece.rows.length);
  }, [found]);
  const rows = useMemo(() => pieces.flatMap(piece => piece.rows), [pieces]);
  const missing = useMemo(() => {
    const byPiece = new Map<number, boolean>();
    for (const target of found?.targets || []) byPiece.set(target.pieceId, (byPiece.get(target.pieceId) ?? false) || target.versions.length > 0);
    return [...byPiece.values()].filter(has => !has).length;
  }, [found]);

  const versionOf = (row: Row) => row.target.versions[chosen[row.key] ?? 0];

  // The instruments Mutopia offers, each with how many lines it can play.
  const families = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) for (const family of new Set(row.target.versions.map(version => familyOf(version.instrument)))) counts.set(family, (counts.get(family) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const pickedRows = rows.filter(row => picked.has(row.key));
  const pickedFamilies = new Set(pickedRows.map(row => familyOf(versionOf(row).instrument)));
  const family = pickedFamilies.size === 1 ? [...pickedFamilies][0] : '';

  const setAll = (some: Row[], on: boolean) => setPicked(prev => {
    const next = new Set(prev);
    for (const row of some) if (on) next.add(row.key); else next.delete(row.key);
    return next;
  });
  // A shift-click checks, or clears, every line from the one clicked before.
  const toggle = (row: Row, shift: boolean) => {
    const at = rows.indexOf(row);
    const on = !picked.has(row.key);
    const from = shift && lastClicked.current != null ? Math.min(lastClicked.current, at) : at;
    const to = shift && lastClicked.current != null ? Math.max(lastClicked.current, at) : at;
    setAll(rows.slice(from, to + 1), on);
    lastClicked.current = at;
  };
  const chooseFamily = (wanted: string) => setChosen(prev => {
    const next = { ...prev };
    for (const row of rows) {
      const index = row.target.versions.findIndex(version => familyOf(version.instrument) === wanted);
      if (index >= 0) next[row.key] = index;
    }
    return next;
  });

  const picks = pickedRows.flatMap(row => versionOf(row).entries.map(entry => ({ pieceId: row.target.pieceId, partWorkId: row.target.partWorkId, pdf: entry.pdf })));

  const fetchThem = async () => {
    setFetching(true);
    try {
      const files = await bookSectionsService.fetchMutopia(scoreId, picks);
      toast(`${pickedRows.length} ${pickedRows.length === 1 ? 'piece' : 'pieces'} from Mutopia, in one PDF, each marked at its pages`, { tone: 'success' });
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
    <Dialog show onClose={onClose} size="lg" scrollable title="Its pieces on Mutopia" className="mutopia-pieces">
      <Dialog.Body>
        {failed ? <p className="mutopia-pieces__empty">{failed}</p>
          : !found ? <Loading>Reading the composer’s pieces on Mutopia…</Loading>
            : !found.composer ? <p className="mutopia-pieces__empty">Mutopia has no piece of its composer.</p>
              : !pieces.length ? <p className="mutopia-pieces__empty">Mutopia has none of its pieces by {found.composer.name}{found.targets.length ? '' : ': its pieces must be known first'}.</p>
                : (
                  <>
                    <p className="mutopia-pieces__hint">
                      Engraved anew with LilyPond, free to print. Those checked come in one PDF, each piece marked at its pages; a shift-click checks a run.
                      {missing > 0 && ` ${missing} of its pieces ${missing === 1 ? 'is' : 'are'} not on Mutopia.`}
                    </p>
                    <div className="mutopia-pieces__bulk">
                      <AllCheck id="mutopia-all" state={triOf(rows, picked)} onChange={on => setAll(rows, on)}
                        label={`${pickedRows.length} of ${rows.length} ${rows.length === 1 ? 'piece' : 'pieces'}`} />
                      {families.length > 1 && (
                        <Select size="sm" className="mutopia-pieces__family" aria-label="Every piece for" value={family}
                          onChange={event => { if (event.target.value) chooseFamily(event.target.value); }}>
                          {!family && <option value="">Mixed instruments</option>}
                          {families.map(([name, count]) => <option key={name} value={name}>{`${name} (${count})`}</option>)}
                        </Select>
                      )}
                    </div>
                    {pieces.map(piece => (
                      <section key={piece.pieceId} className="mutopia-pieces__piece">
                        {pieces.length > 1 ? (
                          <AllCheck id={`mutopia-piece-${piece.pieceId}`} state={triOf(piece.rows, picked)} onChange={on => setAll(piece.rows, on)}
                            label={<h5>{piece.title}</h5>} />
                        ) : <h5>{piece.title}</h5>}
                        {piece.rows.map(row => {
                          const { target } = row;
                          const version = versionOf(row);
                          const first = version.entries[0];
                          return (
                            <div key={row.key} className="mutopia-piece">
                              <div className="mutopia-piece__head">
                                <Form.Check type="checkbox" id={`mutopia-${row.key}`} checked={picked.has(row.key)}
                                  onChange={event => toggle(row, Boolean((event.nativeEvent as MouseEvent).shiftKey))}
                                  label={<span className="mutopia-piece__name">{target.partWorkId ? target.name : 'The whole'}</span>} />
                                {target.versions.length > 1 ? (
                                  <Select size="sm" className="mutopia-piece__version" aria-label={`Version of ${target.name}`} value={chosen[row.key] ?? 0}
                                    onChange={event => setChosen(prev => ({ ...prev, [row.key]: Number(event.target.value) }))}>
                                    {target.versions.map((one, i) => <option key={i} value={i}>{labelOf(one, target.versions)}</option>)}
                                  </Select>
                                ) : <span className="mutopia-piece__instrument">{labelOf(version, target.versions)}</span>}
                              </div>
                              <div className="mutopia-piece__text">
                                <div className="mutopia-piece__meta">
                                  {[version.entries.map(entry => entry.title).join(' + '), version.instrument, first.opus, first.source, first.licence].filter(Boolean).join(' · ')}
                                </div>
                                {first.preview && <img className="mutopia-piece__preview" src={first.preview} alt="" loading="lazy" />}
                              </div>
                            </div>
                          );
                        })}
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
          <Button variant="primary" icon={<BsDownload />} loading={fetching} disabled={!pickedRows.length} onClick={fetchThem}>
            {`Fetch ${pickedRows.length} ${pickedRows.length === 1 ? 'piece' : 'pieces'}`}
          </Button>
        )}
      </Dialog.Footer>
    </Dialog>
  );
};

export default MutopiaPieces;
