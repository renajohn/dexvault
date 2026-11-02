import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Menu, { MenuChevron } from './shared/Menu';
import Button from './shared/Button';
import Spinner from './shared/Spinner';
import { outputHint, useOutputs, type OutputWaking } from '../services/outputs';
import { localOutputName, player, type PlayerOutput } from '../services/player';
import './OutputWaking.css';

/**
 * A play on its way to an appliance that does not sound yet: the Onkyo
 * turned on and waited for, its network coming and going, the track being
 * given. What the bar and the full screen say of it, the steps over the bar,
 * and the way out: listen elsewhere, at once.
 */

const clock = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Moved on every second while there is a wait to count. */
const useNow = (counting: boolean): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!counting) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [counting]);
  return now;
};

export interface WakeWords {
  /** "Salon is waking up · 0:24". */
  text: string;
  /** Gold while it goes as it should; orange when its network comes and goes. */
  tone: 'gold' | 'orange';
  /** How long it has waited, in ms. */
  waited: number;
}

/** What the wait says, counted every second. */
export const useWakeWords = (waking: OutputWaking | null, name: string): WakeWords | null => {
  const now = useNow(waking != null);
  if (!waking) return null;
  const waited = Math.max(0, now - waking.since);
  const counted = ` · ${clock(waited)}`;
  const tone = waking.unsteady ? 'orange' : 'gold';
  if (waking.step === 'on') return { text: `Turning ${name} on…`, tone, waited };
  if (waking.step === 'starting') return { text: `Starting on ${name}…`, tone, waited };
  if (waking.poweredOn) {
    return { text: waking.unsteady ? `${name} is waking up, its network comes and goes${counted}` : `${name} is waking up${counted}`, tone, waited };
  }
  return { text: waking.unsteady ? `${name}’s network comes and goes${counted}` : `Waiting for ${name}${counted}`, tone, waited };
};

/** A wait worth its steps: a receiver turned on, its network waited for, or a start that takes long. */
export const isLongWake = (waking: OutputWaking | null, words: WakeWords | null): boolean =>
  Boolean(waking && (waking.poweredOn || waking.step === 'network' || (words?.waited ?? 0) >= 3000));

/**
 * The way out of a wait: this browser, or another appliance that answers.
 * The play goes there at once, from where it was; the one waited for is
 * no longer waited for (back to standby if DexVault turned it on).
 */
export const ListenElsewhere: React.FC<{ waitingFor: string; drop?: 'up' | 'down'; align?: 'start' | 'end'; size?: 'sm' | 'md' }> = ({
  waitingFor, drop = 'up', align = 'end', size = 'sm',
}) => {
  const list = useOutputs();
  const others = list.filter(one => one.id !== waitingFor && one.reachable && one.power !== 'standby');
  return (
    <Menu drop={drop} align={align} label="Listen elsewhere" trigger={(props, open) => (
      <Button {...props} size={size} variant="quiet" className="output-waking__elsewhere">
        Listen elsewhere <MenuChevron open={open} />
      </Button>
    )}>
      <Menu.Section title="Listen now on" />
      <Menu.Item onSelect={() => player.setOutput({ kind: 'local' })}>{localOutputName()}</Menu.Item>
      {others.map(one => {
        const target: PlayerOutput = { kind: 'renderer', id: one.id, name: one.name };
        return <Menu.Item key={one.id} hint={outputHint(one)} onSelect={() => player.setOutput(target)}>{one.name}</Menu.Item>;
      })}
    </Menu>
  );
};

type StepState = 'done' | 'doing' | 'todo';

/**
 * The steps of a long wait, over the bar on a computer: turned on (when
 * DexVault did it), its network, the album started; how long, and the
 * ways out (listen elsewhere, cancel).
 */
export const WakeSteps: React.FC<{ waking: OutputWaking; words: WakeWords; name: string; outputId: string; onCancel: () => void }> = ({
  waking, words, name, outputId, onCancel,
}) => {
  const at = waking.step === 'on' ? 0 : waking.step === 'network' ? 1 : 2;
  const stateOf = (step: number): StepState => (step < at ? 'done' : step === at ? 'doing' : 'todo');
  const networkHint = waking.unsteady ? 'Its network comes and goes: still trying, up to 5 min'
    : words.waited > 60_000 ? 'Longer than usual: still trying, up to 5 min'
      : waking.poweredOn ? 'Usually half a minute after it wakes' : 'It plays as soon as it answers';
  const steps: Array<{ key: string; state: StepState; words: string; hint?: string }> = [
    ...(waking.poweredOn ? [{ key: 'on', state: stateOf(0), words: `Turning ${name} on`, hint: at > 0 ? 'Switched to NET' : undefined }] : []),
    { key: 'network', state: stateOf(1), words: waking.poweredOn ? 'Waiting for its network' : `Waiting for ${name} to answer`, hint: at === 1 ? networkHint : undefined },
    { key: 'starting', state: stateOf(2), words: 'Starting the album' },
  ];
  // Laid on the page, not in the bar: the bar's own layer would leave its glass unblurred.
  return createPortal(
    <div className="menu-surface output-waking-steps" role="status" aria-live="polite">
      <div className="output-waking-steps__head">
        <span>Starting on {name}</span>
        <span className="output-waking-steps__clock">{clock(words.waited)}</span>
      </div>
      <ol className="output-waking-steps__list">
        {steps.map(step => (
          <li key={step.key} className={`output-waking-step output-waking-step--${step.state}${step.key === 'network' && waking.unsteady && step.state === 'doing' ? ' output-waking-step--unsteady' : ''}`}>
            {step.state === 'doing' ? <Spinner size="sm" /> : <span className="output-waking-step__mark" aria-hidden="true" />}
            <span>
              {step.words}
              {step.hint && <small>{step.hint}</small>}
            </span>
          </li>
        ))}
      </ol>
      <div className="output-waking-steps__foot">
        <ListenElsewhere waitingFor={outputId} />
        <Button size="sm" variant="quiet" onClick={onCancel}>Cancel</Button>
      </div>
    </div>,
    document.body,
  );
};
