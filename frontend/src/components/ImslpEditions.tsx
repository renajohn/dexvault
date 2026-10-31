import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BsBoxArrowUpRight, BsPaperclip } from 'react-icons/bs';
import bookSectionsService, { ImslpEdition, ScoreFile } from '../services/bookSectionsService';
import { imslpPieceUrl } from '../services/scorePiecesService';
import Button from './shared/Button';
import Dialog from './shared/Dialog';
import { Loading } from './shared/Spinner';
import toast from './shared/Toast';
import './ImslpEditions.css';

type File = ImslpEdition['files'][number];

const plain = (text: string) => text.replace(/[\s.]/g, '').toUpperCase();

/** The name a file attached from it is kept under: "E. Fromont, 1905", "Jean Jobert, 1927 · Clair de lune (No.3)". */
export const labelOfEdition = (edition: ImslpEdition, file: File) => [
  edition.name,
  edition.section !== 'Complete' ? edition.section : null,
  file.title !== 'Complete Score' ? file.title : null,
].filter(Boolean).join(' · ');

/**
 * The editions IMSLP holds of a score's work, to take one as its PDF. IMSLP
 * checks that a person downloads, so the browser downloads it there; the file
 * it gave is then attached here, named after its edition. One's own edition
 * (its plate, HN 381, the score's number) comes first, then the most downloaded.
 */
const ImslpEditions: React.FC<{
  scoreId: number;
  /** The score's number, "HN 381", to know its own edition among them. */
  reference: string | null;
  onClose: () => void;
  onAdded: (files: ScoreFile[]) => void;
}> = ({ scoreId, reference, onClose, onAdded }) => {
  const [found, setFound] = useState<{ page: string | null; editions: ImslpEdition[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // The file downloaded on IMSLP, to attach once the browser has it.
  const [chosen, setChosen] = useState<{ edition: ImslpEdition; file: File } | null>(null);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let current = true;
    bookSectionsService.imslpEditions(scoreId)
      .then(result => { if (current) setFound(result); })
      .catch(error => { if (current) setFailed((error as Error).message); });
    return () => { current = false; };
  }, [scoreId]);

  const own = (edition: ImslpEdition) => Boolean(reference && edition.plate && plain(edition.plate) === plain(reference));
  const sections = useMemo(() => {
    const bySection = new Map<string, ImslpEdition[]>();
    for (const edition of found?.editions || []) bySection.set(edition.section, [...(bySection.get(edition.section) || []), edition]);
    const downloads = (edition: ImslpEdition) => edition.files.reduce((n, file) => n + (file.downloads || 0), 0);
    return [...bySection].map(([section, list]) => [section, [...list].sort((a, b) => Number(own(b)) - Number(own(a)) || downloads(b) - downloads(a))] as const);
  }, [found]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = (edition: ImslpEdition, file: File) => {
    window.open(file.download, '_blank', 'noopener');
    setChosen({ edition, file });
  };
  const attach = async (picked: globalThis.File | undefined) => {
    if (!picked || !chosen) return;
    setSending(true);
    try {
      const files = await bookSectionsService.addFile(scoreId, picked, { label: labelOfEdition(chosen.edition, chosen.file), source: 'imslp' });
      toast(`${labelOfEdition(chosen.edition, chosen.file)}: attached from IMSLP`, { tone: 'success' });
      onAdded(files);
      onClose();
    } catch (error) {
      toast((error as Error).message, { tone: 'danger' });
    } finally {
      setSending(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Dialog show onClose={onClose} size="lg" title="Its editions on IMSLP" className="imslp-editions">
      <Dialog.Body>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden data-testid="imslp-pdf-input" onChange={e => attach(e.target.files?.[0])} />
        {failed ? <p className="imslp-editions__empty">{failed}</p>
          : !found ? <Loading>Reading its page on IMSLP…</Loading>
            : !found.editions.length ? (
              <p className="imslp-editions__empty">
                {found.page ? 'IMSLP has no scan of this work in its Scores.' : 'DexVault does not know its page on IMSLP: its pieces may tell it, once they are found.'}
              </p>
            ) : (
              <>
                <p className="imslp-editions__hint">IMSLP checks that a person downloads: download an edition there, then attach the file it gave you.</p>
                {sections.map(([section, list]) => (
                  <section key={section} className="imslp-editions__section">
                    {sections.length > 1 && <h5>{section}</h5>}
                    {list.map(edition => (
                      <div key={edition.files[0].index} className="imslp-edition">
                        {edition.thumbnail ? <img className="imslp-edition__thumb" src={edition.thumbnail} alt="" loading="lazy" /> : <span className="imslp-edition__thumb" />}
                        <div className="imslp-edition__text">
                          <div className="imslp-edition__name">
                            {edition.name}
                            {own(edition) && <span className="imslp-edition__own">Your edition</span>}
                          </div>
                          <div className="imslp-edition__meta">{[edition.editor?.split('\n').join(', '), edition.plate ? `Plate ${edition.plate}` : null, edition.copyright].filter(Boolean).join(' · ')}</div>
                          {edition.files.map(file => (
                            <div key={file.index} className="imslp-edition__file">
                              <span className="imslp-edition__facts">
                                {[file.title, file.pages ? `${file.pages} pp.` : null, file.size, file.downloads ? `${file.downloads.toLocaleString('fr-CH')} downloads` : null].filter(Boolean).join(' · ')}
                              </span>
                              {chosen?.file.index === file.index ? (
                                <Button size="sm" variant="primary" icon={<BsPaperclip />} loading={sending} onClick={() => fileRef.current?.click()}>Attach it</Button>
                              ) : (
                                <Button size="sm" icon={<BsBoxArrowUpRight />} onClick={() => download(edition, file)}>Download on IMSLP</Button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </section>
                ))}
              </>
            )}
      </Dialog.Body>
      <Dialog.Footer>
        {found?.page && <Button variant="quiet" icon={<BsBoxArrowUpRight />} onClick={() => window.open(imslpPieceUrl(found.page), '_blank', 'noopener')}>Its page on IMSLP</Button>}
        <Button variant="quiet" onClick={onClose}>Close</Button>
      </Dialog.Footer>
    </Dialog>
  );
};

export default ImslpEditions;
