import React, { useState } from 'react';
import { BsBookmarkCheck, BsBoxArrowUpRight, BsCheck, BsFileEarmarkPdf, BsPaperclip, BsThreeDots, BsX } from 'react-icons/bs';
import bookSectionsService, { ScoreFile, scoreFileUrl } from '../services/bookSectionsService';
import Button, { IconButton } from './shared/Button';
import Menu from './shared/Menu';
import { TextField } from './shared/TextField';
import { confirm } from './shared/ConfirmDialog';
import toast from './shared/Toast';
import './ScoreFiles.css';

const megabytes = (size: number | null) => (size == null ? 'missing' : size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`);

export const openScoreFile = (file: ScoreFile) => window.open(scoreFileUrl(file.bookId, file.id), '_blank', 'noopener');

/**
 * A score's PDFs, in its card and its sheet: IMSLP's scan, one's own copy
 * scanned… Each opens, is renamed in place, may be the one that opens first,
 * or is deleted after a question. Adding one is the page's (its file input).
 */
const ScoreFiles: React.FC<{
  scoreId: number;
  files: ScoreFile[];
  onChange: (files: ScoreFile[]) => void;
  onAdd: () => void;
  /** Its editions on IMSLP, to take one. */
  onImslp: () => void;
  /** Its pieces' pages marked in one of them; none before its pieces are known. */
  onMark?: (file: ScoreFile) => void;
}> = ({ scoreId, files, onChange, onAdd, onImslp, onMark }) => {
  const [renaming, setRenaming] = useState<{ id: number; label: string } | null>(null);

  const change = async (file: ScoreFile, changes: { label?: string; isDefault?: true }) => {
    try {
      onChange(await bookSectionsService.changeFile(scoreId, file.id, changes));
      setRenaming(null);
    } catch (error) { toast((error as Error).message, { tone: 'danger' }); }
  };
  const remove = async (file: ScoreFile) => {
    if (!(await confirm({ title: `Delete ${file.label}?`, message: 'The PDF goes for good, from DexVault and its disk.', confirmLabel: 'Delete', danger: true }))) return;
    try { onChange(await bookSectionsService.removeFile(scoreId, file.id)); } catch (error) { toast((error as Error).message, { tone: 'danger' }); }
  };

  return (
    <div className="score-files">
      {!files.length && <p className="score-files__empty">No PDF yet: IMSLP may have it.</p>}
      {files.length > 0 && (
        <ul className="score-files__list">
          {files.map(file => (
            <li key={file.id} className="score-files__row">
              <BsFileEarmarkPdf className="score-files__icon" aria-hidden="true" />
              {renaming?.id === file.id ? (
                <span className="score-files__rename">
                  <TextField size="sm" value={renaming.label} autoFocus aria-label="Its name"
                    onChange={e => setRenaming({ id: file.id, label: e.target.value })}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && renaming.label.trim()) change(file, { label: renaming.label });
                      // Escape gives up the name, and leaves the card open.
                      if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null); }
                    }} />
                  <IconButton size="sm" tone="confirm" label="Keep this name" disabled={!renaming.label.trim()} onClick={() => change(file, { label: renaming.label })}><BsCheck /></IconButton>
                  <IconButton size="sm" label="Cancel" onClick={() => setRenaming(null)}><BsX /></IconButton>
                </span>
              ) : (
                <button type="button" className="score-files__name" onClick={() => openScoreFile(file)} title="Open it">
                  {file.label}
                  {file.isDefault && files.length > 1 && <span className="score-files__first">Opens first</span>}
                </button>
              )}
              <span className="score-files__size">{megabytes(file.size)}</span>
              <Menu align="end" trigger={props => <IconButton {...props} size="sm" label={`More for ${file.label}`}><BsThreeDots /></IconButton>}>
                <Menu.Item icon={<BsFileEarmarkPdf />} onSelect={() => openScoreFile(file)}>Open</Menu.Item>
                {onMark && <Menu.Item icon={<BsBookmarkCheck />} onSelect={() => onMark(file)}>Mark its pieces’ pages…</Menu.Item>}
                <Menu.Item onSelect={() => setRenaming({ id: file.id, label: file.label })}>Rename</Menu.Item>
                {!file.isDefault && <Menu.Item onSelect={() => change(file, { isDefault: true })}>Open this one first</Menu.Item>}
                <Menu.Separator />
                <Menu.Item danger onSelect={() => remove(file)}>Delete the PDF</Menu.Item>
              </Menu>
            </li>
          ))}
        </ul>
      )}
      <div className="score-files__add">
        <Button size="sm" variant="quiet" icon={<BsPaperclip />} onClick={onAdd}>{files.length ? 'Add a PDF' : 'Attach PDF'}</Button>
        <Button size="sm" variant="quiet" icon={<BsBoxArrowUpRight />} onClick={onImslp}>From IMSLP…</Button>
      </div>
    </div>
  );
};

export default ScoreFiles;
