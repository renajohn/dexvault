import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BsBoxArrowUpRight, BsFileEarmarkPdf, BsPaperclip, BsThreeDots } from 'react-icons/bs';
import bookSectionsService, { imslpUrl, Score, scorePdfUrl } from '../services/bookSectionsService';
import bookService from '../services/bookService';
import ScoreCard from '../components/ScoreCard';
import { useLocation, useNavigate } from 'react-router-dom';
import Button, { IconButton } from '../components/shared/Button';
import Dialog from '../components/shared/Dialog';
import Menu from '../components/shared/Menu';
import Notice from '../components/shared/Notice';
import { Loading } from '../components/shared/Spinner';
import { TextField } from '../components/shared/TextField';
import toast from '../components/shared/Toast';
import { pieceOf, referenceOf } from '../utils/scoreTitle';
import { scoreMatcher } from '../utils/scoreSearch';
import { useNarrow } from '../utils/useNarrow';
import './ScoresPage.css';

const OTHERS = 'Anthologies & methods';
const plain = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Bach is filed under B: a composer by the last word of their name. */
const surname = (name: string) => (name === OTHERS ? '~' : plain(name.split(' ').slice(-1)[0]));
/** The letter of a composer in the side index: their surname's, without its accent (Dvořák under D). */
const letterOf = (name: string) => (name === OTHERS ? '' : surname(name).charAt(0).toUpperCase());

/** The authors who are not the composer: its editors. */
const editorsOf = (score: Score) => (score.authors || []).filter(a => !score.composer || !plain(score.composer).includes(plain(a.split(' ').slice(-1)[0])));

/**
 * The scores, a section of their own: by composer, each with its PDF to open
 * full screen (attached by hand for now; Dropbox later) and its IMSLP page.
 * The books do not keep a composer, Google's "author" of a score being most
 * often its editor: the ones the titles suggest are offered to confirm.
 */
const ScoresPage: React.FC<{ searchCriteria?: { searchText?: string } }> = ({ searchCriteria }) => {
  const [scores, setScores] = useState<Score[] | null>(null);
  const narrow = useNarrow();
  const filter = searchCriteria?.searchText || '';
  const rootRef = useRef<HTMLDivElement>(null);
  const [reviewing, setReviewing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [composerOf, setComposerOf] = useState<Score | null>(null);
  // The score whose card is open: its pieces and the music playing them.
  // By its id, the card follows the list as it reloads (a PDF attached, its title changed).
  const [openId, setOpenId] = useState<number | null>(null);
  const open = (scores || []).find(s => s.id === openId) || null;
  const setOpen = (score: Score | null) => setOpenId(score?.id ?? null);
  const location = useLocation();
  const navigate = useNavigate();
  const [attaching, setAttaching] = useState<Score | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => bookSectionsService.scores().then(setScores).catch(e => { setScores([]); toast((e as Error).message, { tone: 'danger' }); });
  useEffect(() => { load(); }, []);
  // ?score=12 from an album's card opens that score's card.
  useEffect(() => {
    const wanted = Number(new URLSearchParams(location.search).get('score'));
    if (!wanted || !scores) return;
    const score = scores.find(s => s.id === wanted);
    if (score) setOpen(score);
    navigate(location.pathname, { replace: true });
  }, [location.search, scores]); // eslint-disable-line react-hooks/exhaustive-deps

  const suggested = (scores || []).filter(s => !s.composer && s.composerSuggestion);
  const shown = useMemo(() => (scores || []).filter(scoreMatcher(filter.trim())), [scores, filter]);
  const groups = useMemo(() => {
    const byComposer = new Map<string, Score[]>();
    for (const score of shown) {
      const name = score.composer || OTHERS;
      byComposer.set(name, [...(byComposer.get(name) || []), score]);
    }
    // The anthologies and methods last.
    return [...byComposer].sort((a, b) => Number(a[0] === OTHERS) - Number(b[0] === OTHERS) || surname(a[0]).localeCompare(surname(b[0])));
  }, [shown]);

  /** A score read full screen, from its last page read or at one. */
  const read = (scoreId: number, fileId?: number, page?: number, piece?: string) => {
    const query = new URLSearchParams();
    if (fileId) query.set('file', String(fileId));
    if (page) query.set('page', String(page));
    if (piece) query.set('piece', piece);
    navigate(`/scores/${scoreId}/read${query.size ? `?${query}` : ''}`);
  };

  const attach = async (file: File | undefined) => {
    if (!file || !attaching) return;
    try {
      const files = await bookSectionsService.addFile(attaching.id, file);
      toast(files.length > 1 ? `A PDF is added to ${attaching.title}` : `The PDF of ${attaching.title} is attached`, { tone: 'success' });
      load();
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' });
    } finally {
      setAttaching(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="scores-page" ref={rootRef}>
      <div className="scores-page__head">
        <h2>Scores <small>{scores ? `(${scores.length})` : ''}</small></h2>
        <Button variant="primary" onClick={() => setAdding(true)}>Add Score</Button>
      </div>

      {suggested.length > 0 && (
        <Notice className="scores-page__notice" title={`${suggested.length} score${suggested.length > 1 ? 's' : ''} without a composer`}
          action={<Button size="sm" onClick={() => setReviewing(true)}>Review the suggestions</Button>}>
          Their composer is read from their title or their work; Google's author is most often an editor.
        </Notice>
      )}

      <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden data-testid="score-pdf-input" onChange={e => attach(e.target.files?.[0])} />

      {!scores ? <Loading>Loading the scores…</Loading>
        : !shown.length ? <p className="scores-page__empty">{filter ? `No score with “${filter}”.` : 'No score yet.'}</p>
          : groups.map(([composer, list], i) => {
            const letter = letterOf(composer);
            const first = i === 0 || letterOf(groups[i - 1][0]) !== letter;
            return (
              <section key={composer} className="scores-page__composer" {...(first && letter ? { 'data-first-letter': /[A-Z]/.test(letter) ? letter : '#' } : {})}>
                <h3>{composer} <small>{list.length} score{list.length > 1 ? 's' : ''}</small></h3>
                {list.map(score => {
                  const reference = referenceOf(score.title);
                  const editors = editorsOf(score);
                  return (
                    <div key={score.id} className="scores-page__score" onClick={() => setOpen(score)}>
                      {score.cover ? <img src={bookService.getImageUrl(score.cover) || ''} alt="" loading="lazy" /> : <span className="scores-page__blank" />}
                      <span className="scores-page__text">
                        <span className="scores-page__title">{pieceOf(score.title)}</span>
                        <span className="scores-page__meta">{[score.publisher, editors.length ? `ed. ${editors.join(', ')}` : null].filter(Boolean).join(' · ')}</span>
                      </span>
                      {score.heardCount ? <span className="scores-page__heard" title="Its pieces the music plays">♪ {score.heardCount}{narrow ? '' : ' in your music'}</span>
                        : !score.pieceCount && <span className="scores-page__find" title="Its pieces are not known yet">Contents?</span>}
                      {reference && <span className="scores-page__reference">{reference}</span>}
                      <span className="scores-page__actions" onClick={e => e.stopPropagation()}>
                        {score.ebookFile ? (
                          <Button size="sm" icon={<BsFileEarmarkPdf />} onClick={() => read(score.id)}>PDF</Button>
                        ) : !narrow && (
                          <Button size="sm" variant="quiet" icon={<BsPaperclip />} onClick={() => { setAttaching(score); fileRef.current?.click(); }}>Attach PDF</Button>
                        )}
                        {!narrow && <IconButton label="On IMSLP" size="sm" onClick={() => window.open(imslpUrl(score), '_blank', 'noopener')}><BsBoxArrowUpRight /></IconButton>}
                        <Menu align="end" trigger={props => <IconButton {...props} label="More" size="sm"><BsThreeDots /></IconButton>}>
                          {narrow && !score.ebookFile && <Menu.Item icon={<BsPaperclip />} onSelect={() => { setAttaching(score); fileRef.current?.click(); }}>Attach PDF</Menu.Item>}
                          {narrow && <Menu.Item icon={<BsBoxArrowUpRight />} onSelect={() => window.open(imslpUrl(score), '_blank', 'noopener')}>On IMSLP</Menu.Item>}
                          {narrow && <Menu.Separator />}
                          <Menu.Item onSelect={() => setComposerOf(score)}>Change the composer</Menu.Item>
                          {score.ebookFile && <Menu.Item onSelect={() => { setAttaching(score); fileRef.current?.click(); }}>Add a PDF</Menu.Item>}
                        </Menu>
                      </span>
                    </div>
                  );
                })}
              </section>
            );
          })}


      {reviewing && <ComposerReview scores={suggested} onClose={() => setReviewing(false)} onSaved={() => { setReviewing(false); load(); }} />}
      {composerOf && <ComposerReview scores={[composerOf]} onClose={() => setComposerOf(null)} onSaved={() => { setComposerOf(null); load(); }} />}

      {(open || adding) && (
        <ScoreCard
          score={adding ? null : open}
          onClose={() => { setOpen(null); setAdding(false); }}
          onAttach={score => { setAttaching(score); fileRef.current?.click(); }}
          onRead={read}
          onChanged={() => load()}
          onCreated={id => { setAdding(false); load().then(() => setOpenId(id)); }}
          onDeleted={() => { setOpen(null); load(); }}
        />
      )}
    </div>
  );
};

/** The composers to confirm: the one suggested, which may be corrected, or left out. */
const ComposerReview: React.FC<{ scores: Score[]; onClose: () => void; onSaved: () => void }> = ({ scores, onClose, onSaved }) => {
  const [names, setNames] = useState<Record<number, string>>(() => Object.fromEntries(scores.map(s => [s.id, s.composer || s.composerSuggestion || ''])));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const { changed } = await bookSectionsService.setComposers(scores.map(s => ({ id: s.id, composer: names[s.id]?.trim() || null })));
      toast(`${changed} composer${changed > 1 ? 's' : ''} kept`, { tone: 'success' });
      onSaved();
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' });
      setSaving(false);
    }
  };
  return (
    <Dialog show onClose={onClose} title={scores.length > 1 ? 'The composers of the scores' : `The composer of ${scores[0].title}`} size="lg">
      <Dialog.Body className="scores-review">
        {scores.length > 1 && <p className="scores-review__hint">Read from the title or the work. Correct one, or empty it to leave the score among the anthologies.</p>}
        {scores.map(score => (
          <label key={score.id} className="scores-review__row">
            <span className="scores-review__title">{score.title}<small>{(score.authors || []).join(', ')}</small></span>
            <TextField size="sm" value={names[score.id] || ''} placeholder="No composer: an anthology, a method"
              aria-label={`Composer of ${score.title}`} onChange={e => setNames(prev => ({ ...prev, [score.id]: e.target.value }))} />
          </label>
        ))}
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={saving}>{scores.length > 1 ? 'Keep these composers' : 'Keep it'}</Button>
      </Dialog.Footer>
    </Dialog>
  );
};

export default ScoresPage;
