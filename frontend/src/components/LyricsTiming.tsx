import React, { useEffect, useMemo, useState } from 'react';
import { BsChatQuote, BsChevronLeft, BsChevronRight, BsInfoCircle, BsPauseFill, BsPlayFill, BsSliders } from 'react-icons/bs';
import musicService, { type LyricsVersion } from '../services/musicService';
import { player, usePlayer } from '../services/player';
import { shiftLabel, sliderShift } from '../utils/lyricsTiming';
import { HELP, MOST_SHIFT_SEC, SPEEDS, type LyricsTiming } from './useLyricsTiming';
import Button, { IconButton } from './shared/Button';
import LyricsWave from './LyricsWave';
import Menu from './shared/Menu';
import Dialog from './shared/Dialog';
import Segmented from './shared/Segmented';
import { Loading } from './shared/Spinner';
import './LyricsTiming.css';

/** "sings 1.4 s later", "sings 0.3 s earlier", "in step": how a version sings against the words the track has now. */
const lagWord = (lag: number | null): string | null => {
  if (lag == null) return null;
  if (Math.abs(lag) < 0.25) return 'in step';
  return `sings ${Math.abs(lag).toFixed(1)} s ${lag > 0 ? 'later' : 'earlier'}`;
};

const length = (seconds: number | null) =>
  seconds == null ? null : `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/** What tells a version from the words in use first: in use; the same words, sung earlier or later; or the lines that differ. */
const versionHead = (version: LyricsVersion): string | null => {
  if (version.current) return 'In use';
  if (version.changed === 0) return ['Same words', lagWord(version.lag) ?? (version.timed ? null : 'not timed')].filter(Boolean).join(', ');
  return version.changed ? `${version.changed} ${version.changed === 1 ? 'line differs' : 'lines differ'}` : null;
};

/** The rest, in small: timed or not, its length, its lag when its words differ, its album, its copies. */
const versionFacts = (version: LyricsVersion): string => [
  version.timed ? 'Timed' : 'Not timed',
  length(version.durationSec),
  !version.current && version.changed !== 0 ? lagWord(version.lag) : null,
  version.album || null,
  version.copies > 1 ? `${version.copies} copies` : null,
].filter(Boolean).join(' · ');

/**
 * LRCLIB's other texts for the track, to choose one: the first lines of
 * each, timed or not, its length, how it sings against the words in use.
 */
const VersionsDialog: React.FC<{ timing: LyricsTiming; onClose: () => void }> = ({ timing, onClose }) => {
  // Undefined while they are looked for, null when they could not be.
  const [versions, setVersions] = useState<LyricsVersion[] | null | undefined>(undefined);
  const [picked, setPicked] = useState<string | null>(null);
  const where = timing.where;
  useEffect(() => {
    if (!where) return undefined;
    let current = true;
    musicService.getLyricsVersions(where.albumId, where.disc, where.no)
      .then(found => { if (current) setVersions(found.versions); })
      .catch(() => { if (current) setVersions(null); });
    return () => { current = false; };
  }, [where?.albumId, where?.disc, where?.no]); // eslint-disable-line react-hooks/exhaustive-deps

  const others = versions?.filter(version => !version.current) ?? [];
  return (
    <Dialog onClose={onClose} size="md" zIndex={12000} backdropClassName="over-player-backdrop" icon={<BsChatQuote />} title="Other versions" scrollable>
      <Dialog.Body>
        {versions === undefined && <Loading>Asking LRCLIB…</Loading>}
        {versions === null && <p className="lyrics-versions-none">LRCLIB could not be asked. Try again in a while.</p>}
        {versions && others.length === 0 && <p className="lyrics-versions-none">LRCLIB has no other version of this track.</p>}
        {versions && others.length > 0 && (
          <div className="lyrics-versions" role="radiogroup" aria-label="Versions">
            {versions.map((version, index) => {
              const same = !version.current && version.changed === 0;
              const head = versionHead(version);
              const facts = versionFacts(version);
              const shown = version.current ? version.preview.slice(0, 2) : same ? [] : version.differing.length > 0 ? version.differing : version.preview.slice(0, 2);
              return (
                <label key={version.id} className={`lyrics-version${version.current ? ' lyrics-version--current' : ''}`}>
                  <input type="radio" name="lyrics-version" value={version.id} disabled={version.current}
                    checked={version.current ? picked === null : picked === version.id} onChange={() => setPicked(version.id)} />
                  <span className="lyrics-version-words">
                    {head && <b>{head}</b>}
                    {shown.map((line, i) => <q key={i}>{line}</q>)}
                    <small>{facts}</small>
                  </span>
                  {!version.current && (
                    <Button size="sm" className="lyrics-version-try" title="Its words on the song now; keep it or not after"
                      onClick={event => { event.preventDefault(); timing.tryVersion(versions, index); onClose(); }}>Try</Button>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!picked} onClick={() => { if (picked) timing.choose(picked); onClose(); }}>Use this version</Button>
      </Dialog.Footer>
    </Dialog>
  );
};

/**
 * The words' menu: fix their timing, save it into the lyrics or go back to
 * LRCLIB's, or another of LRCLIB's versions, tried first. Gold
 * once the timing is fixed or another version chosen.
 */
export const LyricsMenu: React.FC<{ timing: LyricsTiming; canFix: boolean; className?: string }> = ({ timing, canFix, className }) => {
  const [choosing, setChoosing] = useState(false);
  const { lyrics } = timing;
  const state = lyrics?.timing;
  const changed = state === 'fixed' || state === 'saved' || Boolean(lyrics?.chosen);
  return (
    <>
      <Menu align="end" label="Lyrics options" className={className} trigger={props => (
        <IconButton {...props} label={state === 'saved' ? 'Lyrics options: timing saved into the lyrics' : state === 'fixed' ? 'Lyrics options: timing fixed' : 'Lyrics options'}
          active={changed} loading={timing.saving}><BsSliders /></IconButton>
      )}>
        {canFix && <Menu.Item onSelect={timing.start} hint="Shift the words to the voice">Fix timing…</Menu.Item>}
        {state === 'fixed' && <Menu.Item onSelect={() => void timing.saveInto()} hint="Navidrome, Amperfy">Save timing into the lyrics</Menu.Item>}
        <Menu.Item onSelect={() => setChoosing(true)} hint="LRCLIB">Find another version…</Menu.Item>
        {(state === 'fixed' || state === 'saved') && (
          <>
            <Menu.Separator />
            <Menu.Item danger onSelect={timing.reset}>Reset timing</Menu.Item>
          </>
        )}
      </Menu>
      {choosing && <VersionsDialog timing={timing} onClose={() => setChoosing(false)} />}
    </>
  );
};

/**
 * A version being tried on the song: which one, ‹ › to another as the song
 * plays, ▶ ❚❚, and at the end Keep or Revert.
 */
export const TryBar: React.FC<{ timing: LyricsTiming; touch?: boolean; className?: string }> = ({ timing, touch = false, className }) => {
  const playing = usePlayer(state => state.playing);
  const tried = timing.trying;
  if (!tried) return null;
  const size = touch ? 'md' : 'sm';
  const { version } = tried;
  return (
    <div className={['lyrics-timing', 'menu-surface', touch && 'lyrics-timing--touch', className].filter(Boolean).join(' ')} role="group" aria-label="Trying a version">
      <div className="lyrics-try-head">
        <IconButton size={size} label="Previous version" onClick={() => timing.stepTry(-1)} disabled={tried.count < 2}><BsChevronLeft /></IconButton>
        <span className="lyrics-try-what" aria-live="polite">
          <b>{versionHead(version) ?? 'Another version'}</b>
          <small>Version {tried.index + 1} of {tried.count} · {versionFacts(version)}</small>
        </span>
        <IconButton size={size} label="Next version" onClick={() => timing.stepTry(1)} disabled={tried.count < 2}><BsChevronRight /></IconButton>
      </div>
      <div className="lyrics-timing-foot">
        <IconButton size={size} label={playing ? 'Pause' : 'Play'} onClick={() => player.toggle(!playing)}>
          {playing ? <BsPauseFill /> : <BsPlayFill />}
        </IconButton>
        <span className="lyrics-try-spacer" />
        <Button variant="quiet" size={size} onClick={timing.revertTry}>Revert</Button>
        <Button variant="primary" size={size} onClick={timing.keepTried} loading={timing.saving}>Keep</Button>
      </div>
    </div>
  );
};

/**
 * The drawer that fixes the timing: the shift and its (i), ▶ ❚❚ and the
 * speed, the track's wave under its lines' marks, the slider, the lines set
 * by hand, and Save. `touch` makes it for a finger: larger, its help shown on
 * a tap rather than under the pointer.
 */
export const TimingDrawer: React.FC<{ timing: LyricsTiming; songId: string; touch?: boolean; className?: string }> = ({ timing, songId, touch = false, className }) => {
  // An appliance plays at its own pace: slower is for this browser alone.
  const here = usePlayer(state => state.output.kind === 'local');
  const playing = usePlayer(state => state.playing);
  const [help, setHelp] = useState(false);
  const pinned = useMemo(() => new Set(timing.pins.keys()), [timing.pins]);
  const { shift } = timing;
  const size = touch ? 'md' : 'sm';
  return (
    <div className={['lyrics-timing', 'menu-surface', touch && 'lyrics-timing--touch', className].filter(Boolean).join(' ')} role="group" aria-label="Fix timing">
      <div className="lyrics-timing-head">
        <span className="lyrics-timing-shift">
          <output className={Math.abs(shift) > 0.004 ? 'lyrics-timing-moved' : undefined} aria-label="Shift of the words" aria-live="polite">{shiftLabel(shift)}</output>
          <IconButton size={size} label="How it works" title={touch ? undefined : HELP.mouse} active={help} onClick={() => touch && setHelp(shown => !shown)}>
            <BsInfoCircle />
          </IconButton>
        </span>
        <span className="lyrics-timing-play">
          <IconButton size={size} label={playing ? 'Pause' : 'Play'} onClick={() => player.toggle(!playing)}>
            {playing ? <BsPauseFill /> : <BsPlayFill />}
          </IconButton>
          {here && (
            <Segmented label="Speed" size={size === 'md' ? 'md' : 'sm'} value={timing.speed} onChange={timing.changeSpeed}
              options={SPEEDS.map(value => ({ value, label: `${value}×`, tooltip: value === '1' ? 'The song’s own pace' : 'Slower, the same pitch' }))} />
          )}
        </span>
      </div>
      {touch && help && <p className="lyrics-timing-help" onClick={() => setHelp(false)}>{HELP.touch}</p>}
      <LyricsWave songId={songId} lines={timing.lines} pinned={pinned} onPin={timing.pin} onRelease={timing.release} touch={touch} />
      <div className="lyrics-timing-slider">
        <Button size={size} variant="quiet" onClick={() => timing.setShift(shift - 0.1)} title="Words earlier">−0.1</Button>
        <input type="range" className="ui-range" aria-label="Shift the words" min={-MOST_SHIFT_SEC} max={MOST_SHIFT_SEC} step={0.05}
          value={shift} onChange={event => timing.setShift(sliderShift(Number(event.target.value)))} />
        <Button size={size} variant="quiet" onClick={() => timing.setShift(shift + 0.1)} title="Words later">+0.1</Button>
      </div>
      {timing.pins.size > 0 && (
        <div className="lyrics-timing-pins">
          <span>{timing.pins.size === 1 ? '1 line set by hand' : `${timing.pins.size} lines set by hand`}</span>
          <Button size="sm" variant="quiet" onClick={timing.resetPins} title="Back with the others, moved by the slider">Reset</Button>
        </div>
      )}
      <div className="lyrics-timing-foot">
        <label className="lyrics-timing-into" title="Written in the .lrc beside the rip, for Navidrome and Amperfy, and kept whatever LRCLIB says next">
          <input type="checkbox" checked={timing.intoLyrics} onChange={event => timing.setIntoLyrics(event.target.checked)} /> Into the lyrics
        </label>
        <Button variant="quiet" size={size} onClick={timing.cancel}>Cancel</Button>
        <Button variant="primary" size={size} loading={timing.saving} onClick={timing.save}>Save</Button>
      </div>
    </div>
  );
};

