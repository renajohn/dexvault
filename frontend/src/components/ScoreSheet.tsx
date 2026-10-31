import React, { useEffect, useState } from 'react';
import { BsBoxArrowUpRight, BsFileEarmarkPdf, BsFileMusic, BsPaperclip, BsPencil, BsPrinter, BsThreeDots, BsTrash } from 'react-icons/bs';
import CoverButton from './shared/CoverButton';
import CoverTag, { CoverTagStack } from './shared/CoverTag';
import Segmented from './shared/Segmented';
import Menu from './shared/Menu';
import Button from './shared/Button';
import PhoneSheet, { Fact, usePhoneSheet } from './PhoneSheet';
import './ScoreSheet.css';

type Tab = 'score' | 'pieces' | 'copy';

interface ScoreSheetProps {
  id: number;
  title: string;
  composer: string;
  /** Its edition in a few words: publisher, number, level, price or loan. */
  edition: string[];
  /** Its number in its publisher's catalogue: HN 383. */
  reference: string;
  code: string;
  cover: string;
  borrowed: boolean;
  hasPdf: boolean;
  imslpPage: string | null;
  /** Its pieces the music plays, of all. */
  heard: number;
  total: number;
  /** ScoreView's own parts: what its publisher writes, its pieces, its notes, its edition's form. */
  about: React.ReactNode;
  pieces: React.ReactNode;
  pieceCount: number;
  onAddPiece: (() => void) | null;
  /** Several of its pieces to print at once, when two are marked at least. */
  onPrintSeveral?: (() => void) | null;
  notes: React.ReactNode;
  noteCount: number;
  onAddNote: (() => void) | null;
  /** Its edition as facts, label and words; those with none are left out. */
  facts: Array<[string, string | null]>;
  editing: boolean;
  editionForm: React.ReactNode;
  onEdit: () => void;
  onCancelEdit: () => void;
  /** A note being written: Escape keeps it, the sheet open. */
  writing: boolean;
  onShowCover: () => void;
  /** Its cover shown whole (CoverModal, which has no Escape of its own): Escape closes it first. */
  coverShown: boolean;
  onHideCover: () => void;
  onPdf: () => void;
  onImslp: () => void;
  onHenle: (() => void) | null;
  onAttach: () => void;
  /** Its editions on IMSLP, to take one as its PDF. */
  onFindPdf: () => void;
  /** Its PDFs, listed (ScoreFiles), and how many. */
  files: React.ReactNode;
  fileCount: number;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * A score on a phone: a full screen as a film's or a book's (PhoneSheet)
 * rather than its panel, laying out ScoreView's own parts. Its head (the
 * piece, its composer, its edition), and three tabs: the score (its cover,
 * its PDF and pages, what plays it, what its publisher writes, the notes),
 * its pieces with their recordings, its copy.
 */
const ScoreSheet: React.FC<ScoreSheetProps> = props => {
  const { id, title, composer, edition, reference, cover, borrowed, hasPdf, imslpPage, heard, total, editing, onCancelEdit, writing } = props;
  const [tab, setTab] = useState<Tab>('score');
  useEffect(() => { setTab('score'); }, [id]);
  // The edition being changed opens on its tab.
  useEffect(() => { if (editing) setTab('copy'); }, [editing]);

  // Escape closes the cover shown whole, then cancels an edition being changed; a note being written, or the parts
  // a piece holds being chosen, hold the sheet open.
  const sheet = usePhoneSheet(id, props.onClose, () => {
    if (props.coverShown) { props.onHideCover(); return true; }
    if (editing) { onCancelEdit(); return true; }
    return writing || document.querySelector('.phone-sheet .score-piece__keeping') != null;
  });

  const head = (
    <div className="phone-sheet-head">
      {tab !== 'score' && (
        <button type="button" className="phone-sheet-head__thumb" onClick={() => setTab('score')} aria-label="Back to the score">
          {cover ? <img className="phone-sheet-thumb score-sheet-thumb" src={cover} alt="" /> : <span className="phone-sheet-thumb score-sheet-blank"><BsFileMusic aria-hidden="true" /></span>}
        </button>
      )}
      <div className="phone-sheet-head__words">
        <span className="phone-sheet-head__title" title={title}>{title}</span>
        <span className="phone-sheet-head__by">{composer || 'Composer unknown'}</span>
        <span className="phone-sheet-head__facts">{edition.slice(0, 2).join(' · ')}</span>
      </div>
      <Menu drop="down" align="end" label="More" trigger={triggerProps => (
        <button type="button" {...triggerProps} className="phone-sheet-head__more" aria-label="More"><BsThreeDots aria-hidden="true" /></button>
      )}>
        <Menu.Item icon={<BsPencil />} onSelect={props.onEdit}>Change its edition</Menu.Item>
        <Menu.Item icon={<BsPaperclip />} onSelect={props.onAttach}>{hasPdf ? 'Add a PDF' : 'Attach PDF'}</Menu.Item>
        <Menu.Separator />
        <Menu.Item icon={<BsTrash />} danger onSelect={props.onDelete}>Delete the score</Menu.Item>
      </Menu>
    </div>
  );

  const scoreTab = (
    <div className="phone-sheet-scroll" key={`score-${id}`}>
      {/* The cover large, its number and its loan where a cover's tags go, its PDF bottom right. A touch shows it whole. */}
      <div className="score-sheet-cover">
        {cover ? (
          <button type="button" className="score-sheet-cover__show" onClick={props.onShowCover} aria-label="Show the cover">
            <img src={cover} alt={`${title} cover`} />
          </button>
        ) : <span className="score-sheet-blank"><BsFileMusic aria-hidden="true" /></span>}
        {(reference || borrowed) && (
          <CoverTagStack className="score-sheet-cover__tags">
            {reference && <CoverTag>{reference}</CoverTag>}
            {borrowed && <CoverTag variant="alert">Borrowed</CoverTag>}
          </CoverTagStack>
        )}
        {hasPdf && (
          <CoverButton className="score-sheet-cover__pdf" reveal="always" label="Open the PDF" onClick={props.onPdf}><BsFileEarmarkPdf aria-hidden="true" /></CoverButton>
        )}
      </div>

      <div className="score-sheet-acts">
        {hasPdf ? (
          <>
            <Button size="sm" icon={<BsFileEarmarkPdf />} onClick={props.onPdf}>PDF</Button>
            <Button size="sm" variant="quiet" icon={<BsBoxArrowUpRight />} onClick={props.onImslp}>On IMSLP</Button>
          </>
        ) : (
          <>
            <Button size="sm" icon={<BsBoxArrowUpRight />} onClick={props.onFindPdf}
              title={imslpPage ? `Its editions on IMSLP: ${imslpPage}` : 'Its editions on IMSLP'}>Find the PDF on IMSLP</Button>
            <Button size="sm" variant="quiet" icon={<BsPaperclip />} onClick={props.onAttach}>Attach PDF</Button>
          </>
        )}
        {props.onHenle && <Button size="sm" variant="quiet" icon={<BsBoxArrowUpRight />} onClick={props.onHenle}>henle.de</Button>}
      </div>
      {total > 0 && (
        <button type="button" className="score-sheet-heard" onClick={() => setTab('pieces')}>
          {heard > 0 ? <><strong>♪ {heard} of {total}</strong> in your music</> : `${total} piece${total === 1 ? '' : 's'}, none in your music yet`}
        </button>
      )}

      {props.about && (
        <section className="phone-sheet-section">
          <h5>About</h5>
          {props.about}
        </section>
      )}

      <section className="phone-sheet-section">
        <h5 className="phone-sheet-section__head">
          <span>Notes</span>
          {props.onAddNote
            ? <Button size="sm" variant="quiet" className="score-sheet-add" onClick={props.onAddNote}>+ A note</Button>
            : props.noteCount > 0 && <span className="phone-sheet-muted">{props.noteCount}</span>}
        </h5>
        {props.notes}
      </section>
    </div>
  );

  const piecesTab = (
    <div className="phone-sheet-scroll score-sheet-pieces" key={`pieces-${id}`}>
      <section className="phone-sheet-section">
        <h5 className="phone-sheet-section__head">
          <span>{props.pieceCount ? 'Its pieces' : 'Its pieces, to find'}</span>
          <span className="score-sheet-heads">
            {props.onPrintSeveral && <Button size="sm" variant="quiet" icon={<BsPrinter />} onClick={props.onPrintSeveral}>Print several…</Button>}
            {props.onAddPiece && <Button size="sm" variant="quiet" className="score-sheet-add" onClick={props.onAddPiece}>+ Add a piece</Button>}
          </span>
        </h5>
        {props.pieces}
      </section>
    </div>
  );

  const shownFacts = props.facts.filter((fact): fact is [string, string] => Boolean(fact[0] && fact[1]));
  const copyTab = (
    <div className="phone-sheet-scroll" key={`copy-${id}`}>
      <section className="phone-sheet-section">
        <h5>Its edition</h5>
        {editing ? props.editionForm : (
          <>
            {shownFacts.length > 0 ? (
              <dl className="phone-sheet-facts">
                {shownFacts.map(([label, words]) => <Fact key={label} label={label}>{words}</Fact>)}
              </dl>
            ) : <p className="phone-sheet-muted score-sheet-line">Nothing known of its edition.</p>}
            <Button size="sm" icon={<BsPencil />} className="score-sheet-change" onClick={props.onEdit}>Change its edition</Button>
          </>
        )}
      </section>

      <section className="phone-sheet-section">
        <h5>{props.fileCount > 1 ? 'Its PDFs' : 'Its PDF'}</h5>
        {props.files}
      </section>

      <div className="phone-sheet-manage score-sheet-manage">
        <Button variant="danger" icon={<BsTrash />} onClick={props.onDelete}>Delete</Button>
      </div>
    </div>
  );

  return (
    <PhoneSheet sheet={sheet} label={title} tab={tab} cover={cover || null}>
      {head}
      <Segmented<Tab> kind="tabs" size="sm" block label="Show" className="phone-sheet-tabs" value={tab} onChange={setTab} options={[
        { value: 'score', label: 'Score' },
        { value: 'pieces', label: 'Pieces', count: props.pieceCount > 0 ? props.pieceCount : undefined },
        { value: 'copy', label: borrowed ? 'Borrowed' : 'Owned' },
      ]} />
      {tab === 'score' ? scoreTab : tab === 'pieces' ? piecesTab : copyTab}
    </PhoneSheet>
  );
};

export default ScoreSheet;
