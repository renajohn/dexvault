import React, { useEffect, useRef, useState } from 'react';
import { Form } from 'react-bootstrap';
import { BsArrowRepeat, BsMusicNoteList, BsPauseFill, BsPlayFill, BsStars, BsX, BsDisc } from 'react-icons/bs';
import { Button, Chip, CoverButton, CoverTag, CoverTagStack, Dialog, Menu, MenuChevron, Notice, Segmented, Spinner, TextField, toast, useDialogClose } from './shared';
import NowPlayingBars from './shared/NowPlayingBars';
import { radio, useRadio, BAND, type RadioState } from '../services/radio';
import { usePlayer } from '../services/player';
import musicService from '../services/musicService';
import type { RadioCriteria, RadioPool, RadioSong } from '../services/radioService';
import { coverReady, thumbProps } from '../utils/thumb';
import { useSlideText } from '../utils/slideText';
import { DndContext, TouchSensor, closestCenter, useSensor, useSensors, type Announcements, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MousePointerSensor } from './shared/NextBanner';
import './RadioBanner.css';

/** The albums' stars a pool can start from, by halves. */
const STAR_STEPS = [3, 3.5, 4, 4.5, 5];
const starsWord = (stars: number) => (stars % 1 ? `${Math.floor(stars)}½` : `${stars}`);

const GENRES: Array<{ value: RadioPool['genre']; label: string }> = [
  { value: 'both', label: 'Classical and other' },
  { value: 'classical', label: 'Classical' },
  { value: 'other', label: 'Not classical' },
];

/** The pool in words: its sources, which add up; none, everything that plays. */
export const poolWords = (pool: RadioPool): string => {
  const parts = [
    pool.stars != null && `Albums ${starsWord(pool.stars)}★+`,
    pool.hearts && '♥',
    pool.popular && 'Popular',
  ].filter(Boolean);
  return parts.length ? parts.join(' ∪ ') : 'Everything that plays';
};

const everything = (pool: RadioPool) => pool.stars == null && !pool.hearts && !pool.popular;

/** A count as DexVault writes it: 1 190, a narrow space between the thousands. */
const count = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');

/** A length as the banner says it: 38 min, 2 h 05. */
export const lengthWords = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours} h ${String(minutes).padStart(2, '0')}` : `${minutes} min`;
};

const lengthOf = (songs: RadioSong[]) => songs.reduce((total, song) => total + (song.durationSec || 0), 0);

/**
 * The band's hue from the mean energy of its songs: blue for calm (215),
 * warm for upbeat (15), the Listen Next gold (38) when there is none.
 */
export const tintOf = (songs: RadioSong[]): number => {
  if (songs.length === 0) return 38;
  const mean = songs.reduce((total, song) => total + song.energy, 0) / songs.length;
  return Math.round(215 - ((Math.max(2.5, Math.min(7.5, mean)) - 2.5) / 5) * 200);
};

export interface HeardAs { key: string; label: string; without: RadioCriteria; /** The energy and the tempos, always shown. */ main: boolean }

/** How many moods, styles and languages show before "+N" unfolds the rest. */
export const HEARD_SHOWN = 6;

/** What a prompt was heard as, one chip each, with the criteria left once it is taken away. */
export const heardAs = (criteria: RadioCriteria | null): HeardAs[] => {
  if (!criteria) return [];
  const out: HeardAs[] = [];
  if (criteria.energyMin != null || criteria.energyMax != null) {
    out.push({ key: 'energy', label: `energy ${criteria.energyMin ?? 0}–${criteria.energyMax ?? 10}`,
      without: { ...criteria, energyMin: null, energyMax: null }, main: true });
  }
  (['tempos', 'moods', 'styles', 'langs'] as const).forEach(field => {
    (criteria[field] ?? []).forEach(word => out.push({
      key: `${field}:${word}`, label: word, main: field === 'tempos',
      without: { ...criteria, [field]: (criteria[field] as string[]).filter(one => one !== word) },
    }));
  });
  return out;
};

/** The pool's menu: its sources ticked or not, adding up; the albums' stars from 3 to 5 by halves. */
const PoolMenu: React.FC<{ pool: RadioPool; poolSize: number | null; onClosed: (changed: boolean) => void }> = ({ pool, poolSize, onClosed }) => {
  const atOpen = useRef<string>('');
  const lastStars = useRef<number>(pool.stars ?? 4);
  if (pool.stars != null) lastStars.current = pool.stars;
  return (
    <Menu label="Where the songs come from" className="radio-pool-menu"
      onOpenChange={open => {
        if (open) atOpen.current = JSON.stringify(radio.getState().pool);
        else onClosed(JSON.stringify(radio.getState().pool) !== atOpen.current);
      }}
      trigger={(props, open) => (
        <button type="button" {...props} className="menu-pill radio-banner__pool">
          <span className="menu-pill__muted">From</span> {poolWords(pool)}
          {poolSize != null && <span className="menu-pill__muted">· {count(poolSize)} tracks</span>}
          <MenuChevron open={open} />
        </button>
      )}>
      <Menu.Section title="From, together" />
      <Menu.Check checked={pool.stars != null} onToggle={() => radio.setPool({ stars: pool.stars != null ? null : lastStars.current })}>
        Albums at {starsWord(pool.stars ?? lastStars.current)}★ and more
      </Menu.Check>
      <div className="radio-pool-menu__stars">
        <Segmented size="sm" label="Albums' stars" value={pool.stars != null ? String(pool.stars) : null}
          onChange={value => radio.setPool({ stars: Number(value) })}
          options={STAR_STEPS.map(stars => ({ value: String(stars), label: `${starsWord(stars)}★` }))} />
      </div>
      <Menu.Check checked={pool.hearts} onToggle={() => radio.setPool({ hearts: !pool.hearts })}>My ♥ tracks</Menu.Check>
      <Menu.Check checked={pool.popular} onToggle={() => radio.setPool({ popular: !pool.popular })}>The albums' popular tracks</Menu.Check>
      <Menu.Separator />
      <div className="radio-pool-menu__foot">
        {everything(pool) ? 'Nothing ticked: everything that plays.' : `${poolWords(pool)}: what is ticked adds up.`}
      </div>
    </Menu>
  );
};

const SaveDialog: React.FC<{ state: RadioState; onClose: () => void }> = ({ state, onClose }) => {
  const [name, setName] = useState(`Radio · ${state.prompt}`);
  const [size, setSize] = useState('30');
  const [saving, setSaving] = useState(false);
  const n = Number(size);
  const ahead = Math.min(n, state.songs.length);
  const more = n - ahead;
  // The songs to draw are not known yet: as long, each, as those in hand.
  const mean = state.songs.length ? lengthOf(state.songs) / state.songs.length : 0;
  const length = lengthOf(state.songs.slice(0, ahead)) + more * mean;
  return (
    <Dialog onClose={onClose} icon={<BsMusicNoteList />} title="Save as mixtape" size="sm">
      <SaveBody name={name} setName={setName} size={size} setSize={setSize} ahead={ahead} more={more} length={length} />
      <SaveFoot saving={saving} disabled={!name.trim()} onSave={async close => {
        setSaving(true);
        const albumId = await radio.saveAsMixtape(name, n);
        setSaving(false);
        if (albumId != null) close();
      }} />
    </Dialog>
  );
};

const SaveBody: React.FC<{
  name: string; setName: (name: string) => void; size: string; setSize: (size: string) => void; ahead: number; more: number; length: number;
}> = ({ name, setName, size, setSize, ahead, more, length }) => (
  <Dialog.Body>
    <Form.Group controlId="radio-mixtape-name" className="mb-3">
      <Form.Label>Name</Form.Label>
      <TextField value={name} onChange={event => setName(event.target.value)} autoFocus />
    </Form.Group>
    <Form.Group className="mb-2">
      <Form.Label>Tracks</Form.Label>
      <div>
        <Segmented label="Tracks" value={size} onChange={setSize}
          options={['10', '20', '30', '45'].map(value => ({ value, label: value }))} />
      </div>
    </Form.Group>
    <p className="radio-save__hint">
      {more > 0 ? `The ${ahead} ahead and ${more} more drawn the same way` : `The ${ahead} ahead`}: about {lengthWords(length)},
      a fixed mixtape that Amperfy plays whole.
    </p>
  </Dialog.Body>
);

const SaveFoot: React.FC<{ saving: boolean; disabled: boolean; onSave: (close: () => void) => void }> = ({ saving, disabled, onSave }) => {
  const close = useDialogClose();
  return (
    <Dialog.Footer>
      <span style={{ flex: 1 }} />
      <Button variant="quiet" onClick={close}>Cancel</Button>
      <Button variant="primary" loading={saving} disabled={disabled} onClick={() => onSave(close)}>
        {saving ? 'Saving…' : 'Save in Navidrome'}
      </Button>
    </Dialog.Footer>
  );
};

/**
 * A card of the band, which a drag moves along the others (a mouse past a
 * few pixels, a finger held a moment); the song playing stays first.
 */
const RadioCard: React.FC<{ song: RadioSong; now: boolean; playing: boolean; thinking: boolean }> = ({ song, now, playing, thinking }) => {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: song.songId, disabled: now || thinking });
  const style: React.CSSProperties = { transform: CSS.Translate.toString(transform), transition: transition || undefined };
  const cover = musicService.getImageUrl(song.cover);
  const [failed, setFailed] = useState(false);
  // A movement says its own name, its work under it; a song its artist.
  const title = song.work && song.movement ? song.movement : song.title;
  const under = song.work ?? song.artist;
  return (
    <div ref={setNodeRef} style={style} {...listeners}
      className={`next-banner__card cover-host radio-card${now ? ' radio-card--now' : ' next-banner__card--sortable'}${isDragging ? ' next-banner__card--dragging' : ''}`}
      data-song={song.songId} aria-roledescription={now ? undefined : 'sortable'}>
      <div className={`next-banner__image next-banner__image--music${thinking && !now ? ' radio-card__image--thinking' : ''}`}>
        {cover && !failed ? (
          <img {...thumbProps(cover)} decoding="async" className="cover-img" onLoad={coverReady} alt={song.album}
            onError={() => setFailed(true)} />
        ) : (
          <div className="next-banner__placeholder"><BsDisc size={40} /></div>
        )}
        {now && <span className="radio-card__bars"><NowPlayingBars playing={playing} /></span>}
        <CoverButton className="next-banner__remove-btn" label={now && playing ? 'Skip this one' : 'Not this one'}
          onClick={event => { event.stopPropagation(); radio.remove(song.songId); }}>
          <BsX size={20} />
        </CoverButton>
        {(song.moods[0] || song.styles[0]) && (
          <CoverTagStack className="radio-card__tags">
            {song.moods[0] && <CoverTag variant="plain">{song.moods[0]}</CoverTag>}
            {song.styles[0] && <CoverTag variant="gold">{song.styles[0]}</CoverTag>}
          </CoverTagStack>
        )}
        <span className="radio-card__energy" role="img" aria-label={`Energy ${song.energy} of 10`} title={`Energy ${song.energy} of 10 · ${song.tempo}`}>
          <i style={{ height: `${Math.max(0, Math.min(10, song.energy)) * 10}%` }} />
        </span>
      </div>
      <div className="radio-card__caption" title={`${song.title}\n${song.artist} · ${song.album}`}>
        <b>{title}</b>
        <span>{under}</span>
      </div>
    </div>
  );
};

interface RadioBannerProps {
  /** The switch between the banner's modes, in place of its title. */
  heading: React.ReactNode;
}

/**
 * The Listen Next banner in Radio mode (variant Cloud): the prompt, big and
 * edited in place; where the songs come from; what the prompt was heard as;
 * ten songs ahead, each with its mood, its style and its energy; ▶, ↻ and
 * Save as mixtape…. The band takes the hue of its energy, warm or blue.
 */
const RadioBanner: React.FC<RadioBannerProps> = ({ heading }) => {
  const state = useRadio(current => current);
  const radioInPlayer = usePlayer(view => Boolean(view.album?.radio));
  const playing = usePlayer(view => Boolean(view.album?.radio) && view.playing);
  const [draft, setDraft] = useState(state.prompt);
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);
  /** "+N" pressed: every mood and style the prompt was heard as, shown. */
  const [unfolded, setUnfolded] = useState(false);
  useEffect(() => { setDraft(state.prompt); setUnfolded(false); }, [state.prompt]);
  /** A prompt longer than its field slides to its end and back. */
  const promptField = useRef<HTMLInputElement>(null);
  useSlideText(promptField, draft);

  const thinking = state.status === 'hearing' || state.status === 'drawing';
  const { songs, pool } = state;
  // A mouse drags past a few pixels, for a click to stay a click; a finger holds first, for a swipe to scroll the band.
  const sensors = useSensors(
    useSensor(MousePointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const titleOf = (id: string | number | undefined) => songs.find(song => song.songId === String(id))?.title ?? 'The song';
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${titleOf(active.id)} picked up.`,
    onDragOver: ({ active, over }) => (over ? `${titleOf(active.id)} over ${titleOf(over.id)}.` : `${titleOf(active.id)} is no longer over a song.`),
    onDragEnd: ({ active, over }) => (over ? `${titleOf(active.id)} put where ${titleOf(over.id)} was.` : `${titleOf(active.id)} put back.`),
    onDragCancel: ({ active }) => `${titleOf(active.id)} put back where it was.`,
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    radio.move(songs.findIndex(song => song.songId === active.id), songs.findIndex(song => song.songId === over.id));
  };
  const empty = state.status === 'ready' && songs.length === 0;
  const recent = state.recent.filter(one => one !== state.prompt);
  const criteria = heardAs(state.criteria);
  const words = criteria.filter(one => !one.main);
  const folded = unfolded ? 0 : Math.max(0, words.length - HEARD_SHOWN);
  const shown = [...criteria.filter(one => one.main), ...words.slice(0, words.length - folded)];

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    // Played once drawn, in place of what plays: the player primed within the key.
    if (draft.trim()) radio.listen(draft, { play: true });
  };

  const widen = () => {
    radio.widen().then(() => toast('Looking in everything that plays.'));
  };

  const askFiches = async () => {
    setAsking(true);
    const queued = await radio.askFiches();
    setAsking(false);
    if (queued == null) toast('The fiches were not asked for: the server did not answer', { tone: 'danger' });
    else toast(`${count(queued)} songs wait for their fiche, written as the local LLM is free.`, { tone: 'success' });
  };

  const summary = thinking
    ? <><Spinner size="sm" /> {state.status === 'hearing' ? 'Listening to the words…' : 'Choosing…'}</>
    : songs.length > 0 ? `${songs.length} ahead · ${lengthWords(lengthOf(songs))} · endless` : null;

  return (
    <div className={`next-banner listen-next radio-banner${thinking ? ' radio-banner--thinking' : ''}`}
      style={{ '--radio-hue': tintOf(songs) } as React.CSSProperties} data-hue={tintOf(songs)}>
      <div className="next-banner__header">
        <div className="next-banner__title-section radio-banner__head">
          <BsStars className="next-banner__icon" aria-hidden="true" />
          {heading}
          <span className="radio-banner__summary" aria-live="polite">{summary}</span>
          <span className="radio-banner__end">
            <Button variant="quiet" size="sm" icon={<BsMusicNoteList />} disabled={songs.length === 0 || !state.criteria}
              aria-label="Save as mixtape…" onClick={() => setSaving(true)}>Save as mixtape…</Button>
            <span className="ui-button-group">
              <Button className="radio-banner__button" active={playing || undefined} disabled={songs.length === 0 && !radioInPlayer}
                onClick={() => radio.play()} aria-label={playing ? 'Pause the radio' : 'Play the radio'}
                title={playing ? 'Pause the radio' : 'Play the radio in DexVault'} icon={playing ? <BsPauseFill /> : <BsPlayFill />} />
              <Button className="radio-banner__button" disabled={thinking || (!state.criteria && !state.prompt)}
                onClick={() => radio.redraw(undefined, { fresh: true })} aria-label="Draw again" title="Draw again" icon={<BsArrowRepeat />} />
            </span>
          </span>
        </div>
      </div>

      <form className="radio-banner__prompt" onSubmit={submit}>
        <TextField ref={promptField} size="title" value={draft} onChange={event => setDraft(event.target.value)} spellCheck={false}
          aria-label="What to play" placeholder="What would you like to hear?"
          onKeyDown={event => { if (event.key === 'Escape') setDraft(state.prompt); }} />
      </form>

      <div className="radio-banner__chips">
        <PoolMenu pool={pool} poolSize={state.poolSize} onClosed={changed => { if (changed && state.criteria) radio.redraw(); }} />
        <Menu label="Classical or not" trigger={(props, open) => (
          <button type="button" {...props} className="menu-pill">
            {GENRES.find(one => one.value === pool.genre)?.label}
            <MenuChevron open={open} />
          </button>
        )}>
          {GENRES.map(one => (
            <Menu.Choice key={one.value} selected={pool.genre === one.value}
              onSelect={() => { radio.setPool({ genre: one.value }); if (state.criteria) radio.redraw(); }}>
              {one.label}
            </Menu.Choice>
          ))}
        </Menu>
        {pool.genre !== 'other' && (
          <Chip active={pool.wholeWorks} title="A movement drawn brings its whole work"
            onClick={() => { radio.setPool({ wholeWorks: !pool.wholeWorks }); if (state.criteria) radio.redraw(); }}>
            Whole works
          </Chip>
        )}
        {recent.length > 0 && <span className="radio-banner__label">Recent</span>}
        {recent.map(words => (
          <Chip key={words} onClick={() => radio.listen(words, { play: true })} title={`Play “${words}”`}>{words}</Chip>
        ))}
      </div>

      {criteria.length > 0 && (
        <div className="radio-banner__chips radio-banner__heard">
          <span className="radio-banner__label">Heard as</span>
          {shown.map(one => (
            <Chip key={one.key} removeLabel={`Not “${one.label}”`}
              // From the criteria as they are now: two taken away in a row both go.
              onRemove={() => {
                const now = heardAs(radio.getState().criteria).find(other => other.key === one.key);
                if (now) radio.redraw(now.without);
              }}>{one.label}</Chip>
          ))}
          {folded > 0 && (
            <Chip onClick={() => setUnfolded(true)} title={words.slice(-folded).map(one => one.label).join(', ')}
              aria-label={`${folded} more: ${words.slice(-folded).map(one => one.label).join(', ')}`}>+{folded}</Chip>
          )}
        </div>
      )}

      {state.status === 'failed' && (
        <Notice tone="danger" className="radio-banner__notice"
          action={<Button size="sm" onClick={() => radio.redraw()}>Try again</Button>}>
          The radio did not answer: the local LLM may be busy, or the server down.
        </Notice>
      )}

      {state.status === 'idle' && songs.length === 0 && (
        <p className="radio-banner__idle">Say what you would like to hear: “something upbeat”, “melancholic, a rainy day”, “bright classical for the morning”. ↵ plays it.</p>
      )}

      {empty ? (
        <Notice tone="info" className="radio-banner__notice radio-banner__empty"
          title={`Nothing in ${poolWords(pool)} for “${state.prompt}”.`}
          action={everything(pool) ? undefined : <Button size="sm" onClick={widen}>Look in everything that plays</Button>}>
          {state.fitting ? `${count(state.fitting)} songs fit, all heard lately: they come back after half of them.` : 'No song of it fits these words.'}
        </Notice>
      ) : (songs.length > 0 || thinking) && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}
          accessibility={{ announcements, screenReaderInstructions: { draggable: 'Drag a song to another place in the band.' } }}>
        <div className="next-banner__carousel">
          <SortableContext items={songs.filter((_, at) => !(radioInPlayer && at === 0)).map(song => song.songId)} strategy={horizontalListSortingStrategy}>
          <div className={`next-banner__track radio-banner__track${thinking ? ' radio-banner__track--thinking' : ''}`}>
            {songs.length > 0
              ? songs.map((song, at) => <RadioCard key={song.songId} song={song} now={radioInPlayer && at === 0} playing={playing} thinking={thinking} />)
              : Array.from({ length: BAND }, (_, at) => (
                <div key={at} className="next-banner__card radio-card">
                  <div className="next-banner__image next-banner__image--music next-banner__image--pending" />
                </div>
              ))}
          </div>
          </SortableContext>
        </div>
        </DndContext>
      )}

      {state.missingFiches > 0 && !thinking && (
        <div className="radio-banner__foot">
          <span>{count(state.missingFiches)} songs of this pool have no fiche yet: they are never drawn.</span>
          {state.fichesQueued != null
            ? <span className="radio-banner__queued">{count(state.fichesQueued)} in the writer's queue</span>
            : <Button variant="quiet" size="sm" loading={asking} onClick={askFiches}>Describe them first</Button>}
        </div>
      )}

      {saving && <SaveDialog state={state} onClose={() => setSaving(false)} />}
    </div>
  );
};

export default RadioBanner;
