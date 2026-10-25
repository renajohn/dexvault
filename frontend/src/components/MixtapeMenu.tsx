import React, { useState } from 'react';
import { BsCassetteFill, BsDash, BsPlus } from 'react-icons/bs';
import Menu, { type MenuTriggerProps } from './shared/Menu';
import Dialog from './shared/Dialog';
import Button from './shared/Button';
import TextField from './shared/TextField';
import { byLastChange, createMixtape, heldIn, toggleInMixtape, useMixtapes } from '../utils/mixtapeStore';
import './MixtapeMenu.css';

interface MixtapeMenuProps {
  /** The songs in Navidrome the menu puts in or takes out: one track, or a whole CD. */
  songIds: string[];
  /** A track's title, for the toasts; none for a whole CD. */
  title?: string;
  trigger: (props: MenuTriggerProps, open: boolean) => React.ReactElement;
  align?: 'start' | 'end';
  /** A mixtape just made, for its dialog to open. */
  onCreated?: (albumId: number) => void;
}

/**
 * The mixtapes as toggles, the most recently changed first: a gold ✓ on those
 * holding every song (a click takes them out), a dash and "4 of 17" on those
 * holding some (a click adds the others), nothing on the others (a click adds
 * them at the end); then New mixtape…, which `onNew` asks a name for. The
 * entries of a menu: of the mixtapes' own, and of the phone player's ⋯.
 */
export const MixtapeEntries: React.FC<{ songIds: string[]; title?: string; onNew: () => void }> = ({ songIds, title, onNew }) => {
  const { mixtapes } = useMixtapes();
  const unique = [...new Set(songIds)];
  return (
    <>
      <Menu.Section title={unique.length === 1 ? 'Track in mixtapes' : 'Album in mixtapes'} />
      {byLastChange(mixtapes).map(mixtape => {
        const held = heldIn(mixtape, unique);
        const all = held === unique.length;
        return all ? (
          <Menu.Choice key={mixtape.album.id} selected onSelect={() => toggleInMixtape(mixtape, unique, title)}
            title={`Take ${unique.length === 1 ? 'it' : 'them'} out of ${mixtape.album.title}`} hint={mixtape.songIds.length}>
            {mixtape.album.title}
          </Menu.Choice>
        ) : (
          <Menu.Item key={mixtape.album.id} onSelect={() => toggleInMixtape(mixtape, unique, title)}
            icon={held > 0 ? <BsDash className="mixtape-menu-some" /> : <span className="mixtape-menu-none" />}
            hint={held > 0 ? `${held} of ${unique.length}` : mixtape.songIds.length}
            title={held > 0 ? `Add the ${unique.length - held} missing` : `Add to ${mixtape.album.title}`}>
            {mixtape.album.title}
          </Menu.Item>
        );
      })}
      {mixtapes.length > 0 && <Menu.Separator />}
      <Menu.Item icon={<BsPlus />} onSelect={onNew}>New mixtape…</Menu.Item>
    </>
  );
};

/** A name for a new mixtape holding `songIds`, asked once its entry is chosen: it outlives the menu it came from. */
export const NewMixtapeDialog: React.FC<{ songIds: string[]; title?: string; onClose: () => void; onCreated?: (albumId: number) => void }> = ({
  songIds, title, onClose, onCreated,
}) => {
  const [name, setName] = useState('');
  const [making, setMaking] = useState(false);
  const unique = [...new Set(songIds)];

  const make = async () => {
    if (!name.trim() || making) return;
    setMaking(true);
    const albumId = await createMixtape(name.trim(), unique);
    setMaking(false);
    onClose();
    if (albumId != null) onCreated?.(albumId);
  };

  return (
    <Dialog onClose={onClose} size="sm" zIndex={12000} backdropClassName="over-player-backdrop" icon={<BsCassetteFill />} title="New mixtape">
      <Dialog.Body>
        <p className="mixtape-menu-with">
          {unique.length === 1 && title ? <>With <b>{title}</b>.</> : <>With these {unique.length} tracks.</>} It is made in Navidrome
          too, and Amperfy shows it.
        </p>
        <TextField autoFocus placeholder="Name" value={name} maxLength={200} aria-label="Name of the mixtape"
          onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') make(); }} />
      </Dialog.Body>
      <Dialog.Footer>
        <span style={{ flex: 1 }} />
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={make} loading={making} disabled={!name.trim()}>Create</Button>
      </Dialog.Footer>
    </Dialog>
  );
};

/** The mixtapes' own menu: their entries, opened from `trigger`. */
const MixtapeMenu: React.FC<MixtapeMenuProps> = ({ songIds, title, trigger, align = 'end', onCreated }) => {
  const [naming, setNaming] = useState(false);
  return (
    <>
      <Menu trigger={trigger} align={align} label="Mixtapes">
        <MixtapeEntries songIds={songIds} title={title} onNew={() => setNaming(true)} />
      </Menu>
      {naming && <NewMixtapeDialog songIds={songIds} title={title} onClose={() => setNaming(false)} onCreated={onCreated} />}
    </>
  );
};

export default MixtapeMenu;
