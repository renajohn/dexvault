import React, { useEffect, useMemo, useState } from 'react';
import { BsBoxArrowUpRight, BsCassetteFill, BsFiles, BsHeadphones, BsPencil, BsPlus, BsThreeDots, BsTrash } from 'react-icons/bs';
import MusicThumbnail from './MusicThumbnail';
import Menu from './shared/Menu';
import CoverButton from './shared/CoverButton';
import CollectionHeader from './shared/CollectionHeader';
import EmptyState from './shared/EmptyState';
import { confirm } from './shared/ConfirmDialog';
import { toast } from './shared/Toast';
import musicService, { type MixtapeSummary } from '../services/musicService';
import { forgetMixtape, useMixtapes } from '../utils/mixtapeStore';
import { duplicateMixtape, newMixtape } from '../utils/mixtapeActions';
import { readStored, writeStored } from '../utils/safeStorage';
import './MixtapesGrid.css';

const SORT_KEY = 'dexvault-musicdex-mixtapes-sort';

type MixtapeSort = 'changed' | 'name' | 'length';

const SORTS = [
  { value: 'changed', label: 'Last changed', key: 'Changed', direction: 'Last' },
  { value: 'name', label: 'Name', key: 'Name', direction: 'A-Z' },
  { value: 'length', label: 'Length', key: 'Length', direction: 'Longest' },
];

/** "54 tracks · 3 h 16". */
export const mixtapeLine = (mixtape: MixtapeSummary): string => {
  const count = mixtape.songIds.length;
  if (count === 0) return 'No track yet';
  const seconds = Number(mixtape.album.totalDuration) || 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return `${count} ${count === 1 ? 'track' : 'tracks'} · ${hours > 0 ? `${hours} h ${String(minutes).padStart(2, '0')}` : `${minutes} min`}`;
};

/** The playlist in Navidrome's web player, in a tab opened at once (a tab opened after an answer is held back). */
const openInNavidrome = (albumId: number) => {
  const tab = window.open('', '_blank');
  musicService.getMixtape(albumId)
    .then(details => { if (tab) tab.location.href = details.url; })
    .catch(() => { tab?.close(); toast('Navidrome did not answer', { tone: 'danger' }); });
};

const sortedMixtapes = (mixtapes: MixtapeSummary[], sort: MixtapeSort): MixtapeSummary[] => [...mixtapes].sort(
  sort === 'name' ? (a, b) => a.album.title.localeCompare(b.album.title)
    : sort === 'length' ? (a, b) => (Number(b.album.totalDuration) || 0) - (Number(a.album.totalDuration) || 0)
      : (a, b) => String(b.album.updatedAt ?? '').localeCompare(String(a.album.updatedAt ?? '')),
);

interface MixtapesGridProps {
  /** The search's words: the mixtapes they find, by their name or what they hold. */
  searchText: string;
  /** Albums, Mixtapes: first in the header. */
  viewSwitch: React.ReactNode;
  listenNextIds: Set<number>;
  onListenNextChange: () => void;
  /** Opens a mixtape's card: `fresh` just made (its name typed first, gone if left empty), `naming` to rename it. */
  onOpen: (albumId: number, how?: { fresh?: boolean; naming?: boolean }) => void;
}

/**
 * MusicDex's view of the mixtapes: a grid of Navidrome's mosaics as the
 * albums' is, a tile to make a new one first, each with its name and its
 * length, ▶, Listen Next and ⋯ (Rename, Duplicate, Listen Next, Open in
 * Navidrome, Delete). Sorted by the last changed, their name or length.
 */
const MixtapesGrid: React.FC<MixtapesGridProps> = ({ searchText, viewSwitch, listenNextIds, onListenNextChange, onOpen }) => {
  const { mixtapes, loaded, configured } = useMixtapes();
  const [sort, setSort] = useState<MixtapeSort>(() => {
    const saved = readStored(SORT_KEY);
    return saved === 'name' || saved === 'length' ? saved : 'changed';
  });
  const [found, setFound] = useState<number[] | null>(null);
  const [making, setMaking] = useState(false);

  // With a search, those it finds, by their name or what they hold.
  useEffect(() => {
    setFound(null);
    if (!searchText.trim()) return undefined;
    let current = true;
    musicService.searchAlbums(searchText, { mixtapes: true })
      .then(albums => { if (current) setFound((albums as Array<{ id: number }>).map(album => album.id)); })
      .catch(error => console.warn('Search among the mixtapes failed:', error));
    return () => { current = false; };
  }, [searchText, mixtapes]);

  const shown = useMemo(() => {
    const all = sortedMixtapes(mixtapes, sort);
    return found ? all.filter(mixtape => found.includes(mixtape.album.id)) : searchText.trim() ? [] : all;
  }, [mixtapes, sort, found, searchText]);

  const chooseSort = (value: string) => {
    const next = (value === 'name' || value === 'length' ? value : 'changed') as MixtapeSort;
    setSort(next);
    writeStored(SORT_KEY, next);
  };

  const make = async () => {
    if (making) return;
    setMaking(true);
    const id = await newMixtape();
    setMaking(false);
    if (id != null) onOpen(id, { fresh: true });
  };

  const toggleListenNext = async (mixtape: MixtapeSummary) => {
    try {
      await musicService.toggleListenNext(mixtape.album.id);
      onListenNextChange();
    } catch {
      toast('Listen Next was not changed', { tone: 'danger' });
    }
  };

  const remove = async (mixtape: MixtapeSummary) => {
    const inListenNext = listenNextIds.has(mixtape.album.id);
    const yes = await confirm({
      title: `Delete ${mixtape.album.title}?`,
      message: `${mixtapeLine(mixtape)}. It leaves Navidrome and Amperfy${inListenNext ? ', and Listen Next' : ''}; its tracks stay on their albums.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!yes) return;
    try {
      await musicService.deleteMixtape(mixtape.album.id);
      forgetMixtape(mixtape.album.id);
      if (inListenNext) onListenNextChange();
      toast(<><b>{mixtape.album.title}</b> deleted</>, { tone: 'success' });
    } catch {
      toast('The mixtape was not deleted: Navidrome did not answer', { tone: 'danger' });
    }
  };

  const menuOf = (mixtape: MixtapeSummary) => (
    <Menu align="end" label={`${mixtape.album.title}: more`} trigger={props => (
      <CoverButton {...props} label={`More for ${mixtape.album.title}`} title="More" size="small"
        onClick={event => { event.stopPropagation(); props.onClick?.(event); }}>
        <BsThreeDots aria-hidden="true" />
      </CoverButton>
    )}>
      <Menu.Item icon={<BsPencil />} onSelect={() => onOpen(mixtape.album.id, { naming: true })}>Rename</Menu.Item>
      <Menu.Item icon={<BsFiles />} onSelect={async () => {
        const copy = await duplicateMixtape(mixtape.album.title, mixtape.songIds);
        if (copy != null) onOpen(copy, { naming: true });
      }}>Duplicate</Menu.Item>
      <Menu.Item icon={<BsHeadphones />} hint={listenNextIds.has(mixtape.album.id) ? '✓' : undefined} onSelect={() => toggleListenNext(mixtape)}>
        {listenNextIds.has(mixtape.album.id) ? 'In Listen Next' : 'Listen Next'}
      </Menu.Item>
      <Menu.Item icon={<BsBoxArrowUpRight />} hint="new tab"
        onSelect={() => openInNavidrome(mixtape.album.id)}>Open in Navidrome</Menu.Item>
      <Menu.Separator />
      <Menu.Item icon={<BsTrash />} danger onSelect={() => remove(mixtape)}>Delete mixtape…</Menu.Item>
    </Menu>
  );

  return (
    <div className="mixtapes-view">
      <CollectionHeader
        filteredCount={shown.length}
        totalCount={mixtapes.length}
        itemLabel={mixtapes.length === 1 ? 'mixtape' : 'mixtapes'}
        sortBy={sort}
        sortOptions={SORTS}
        onSortChange={chooseSort}
        showStackToggle={false}
        addButtonLabel="New mixtape"
        onAdd={make}
        leading={viewSwitch}
      />
      {loaded && !configured ? (
        <EmptyState icon="📼" title="No Navidrome" description="Mixtapes are your playlists in Navidrome: DexVault is not connected to it." />
      ) : searchText.trim() && found && shown.length === 0 ? (
        <EmptyState icon="📼" title="No mixtape found" description={`No mixtape is named so or holds “${searchText}”.`} />
      ) : (
        <div className="cd-grid mixtapes-grid">
          {!searchText.trim() && (
            <button type="button" className="mixtapes-new" onClick={make} disabled={making} aria-label="New mixtape">
              <span className="mixtapes-new__tile"><BsPlus aria-hidden="true" /><span>New mixtape</span></span>
            </button>
          )}
          {shown.map(mixtape => (
            <MusicThumbnail key={mixtape.album.id}
              cd={mixtape.album as never}
              onClick={() => onOpen(mixtape.album.id)}
              onListenNextChange={onListenNextChange}
              isInListenNext={listenNextIds.has(mixtape.album.id)}
              dataItemId={mixtape.album.id}
              mixtapeView={{ line: mixtapeLine(mixtape), menu: menuOf(mixtape) }} />
          ))}
          {loaded && mixtapes.length === 0 && (
            <p className="mixtapes-none"><BsCassetteFill aria-hidden="true" /> No mixtape yet: make one, and add tracks to it by their title, their artist or their album.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default MixtapesGrid;
