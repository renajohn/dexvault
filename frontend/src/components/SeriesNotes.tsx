import React, { useEffect, useState } from 'react';
import { BsX } from 'react-icons/bs';
import bookSectionsService, { SeriesNote } from '../services/bookSectionsService';
import Button, { IconButton } from './shared/Button';
import { TextField } from './shared/TextField';
import toast from './shared/Toast';
import './SeriesNotes.css';

/**
 * Notes on a whole series ("Oriane loved this series"), not on a volume:
 * what one says of the series, and who says it.
 */
const SeriesNotes: React.FC<{ series: string }> = ({ series }) => {
  const [notes, setNotes] = useState<SeriesNote[]>([]);
  const [note, setNote] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    bookSectionsService.seriesNotes(series).then(found => { if (live) setNotes(found); }).catch(() => undefined);
    return () => { live = false; };
  }, [series]);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!note.trim()) return;
    setSaving(true);
    try {
      const added = await bookSectionsService.addSeriesNote(series, note.trim(), name.trim() || undefined);
      setNotes(prev => [...prev, added]);
      setNote('');
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' });
    } finally { setSaving(false); }
  };

  const remove = async (id: number) => {
    try {
      await bookSectionsService.deleteSeriesNote(id);
      setNotes(prev => prev.filter(n => n.id !== id));
    } catch (e) { toast((e as Error).message, { tone: 'danger' }); }
  };

  return (
    <div className="series-notes" onClick={e => e.stopPropagation()}>
      {notes.map(n => (
        <div key={n.id} className="series-notes__note">
          <span className="series-notes__words">{n.note}</span>
          <span className="series-notes__who">{[n.name, new Date(n.createdAt).toLocaleDateString('fr-CH')].filter(Boolean).join(', ')}</span>
          <IconButton label="Remove the note" size="sm" onClick={() => remove(n.id)}><BsX /></IconButton>
        </div>
      ))}
      <form className="series-notes__form" onSubmit={add}>
        <TextField size="sm" className="series-notes__field" value={note} onChange={e => setNote(e.target.value)}
          placeholder="A note on the series…" aria-label="A note on the series" />
        <TextField size="sm" className="series-notes__name" value={name} onChange={e => setName(e.target.value)} placeholder="Who" aria-label="Who says it" />
        <Button size="sm" type="submit" loading={saving} disabled={!note.trim()}>Add</Button>
      </form>
    </div>
  );
};

export default SeriesNotes;
