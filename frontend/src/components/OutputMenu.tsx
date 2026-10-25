import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BsDash, BsPlus, BsSliders, BsSpeaker, BsVolumeDownFill, BsVolumeMuteFill, BsVolumeUpFill } from 'react-icons/bs';
import Menu, { type MenuTriggerProps } from './shared/Menu';
import { IconButton } from './shared/Button';
import OutputSettings from './OutputSettings';
import outputs, { outputHint, useOutputs, type Output } from '../services/outputs';
import { localOutputName, player, reportOutputError, sameOutput, usePlayer, type PlayerOutput } from '../services/player';
import './OutputMenu.css';

/** The slider sends the volume at most this often while it is dragged, and once more where it is let go. */
export const VOLUME_EVERY_MS = 400;
/** After a move, the slider waits this long before it follows the volume the appliance tells again. */
const HOLD_MS = 1500;

/**
 * A value sent at most once every `ms`: the first at once, the last always,
 * those in between dropped, so a slider dragged sends no burst of requests.
 * `flush` sends the last at once (the slider let go).
 */
export const throttled = <T,>(send: (value: T) => void, ms = VOLUME_EVERY_MS) => {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;
  const fire = () => {
    timer = null;
    if (!pending) return;
    last = Date.now();
    const { value } = pending;
    pending = null;
    send(value);
  };
  return {
    push: (value: T) => {
      pending = { value };
      if (timer) return;
      const wait = ms - (Date.now() - last);
      if (wait <= 0) fire();
      else timer = setTimeout(fire, wait);
    },
    flush: () => {
      if (timer) clearTimeout(timer);
      fire();
    },
    cancel: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
};

/**
 * The volume of an appliance: muted, − and +, a slider up to its ceiling, the
 * value in figures. `slim`, on the phone's full screen: the slider alone
 * between a quiet speaker (mute) and a loud one.
 */
export const OutputVolume: React.FC<{ output: Output; slim?: boolean }> = ({ output, slim = false }) => {
  const max = Math.max(0, output.maxVolume);
  const known = output.volume != null;
  const told = Math.min(max, output.volume ?? 0);
  const [value, setValue] = useState(told);
  const touched = useRef(0);
  const sender = useMemo(() => throttled<number>(volume => {
    outputs.volume(output.id, { volume }).catch(reportOutputError);
  }), [output.id]);
  useEffect(() => () => sender.flush(), [sender]);

  // What the appliance says, once the hand has left the slider a while.
  useEffect(() => {
    if (Date.now() - touched.current > HOLD_MS) setValue(told);
    else {
      const timer = setTimeout(() => setValue(Math.min(max, (output.volume ?? 0))), HOLD_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [told, max, output.volume]);

  const move = (volume: number, now = false) => {
    const next = Math.max(0, Math.min(max, Math.round(volume)));
    touched.current = Date.now();
    setValue(next);
    sender.push(next);
    if (now) sender.flush();
  };

  const slider = (
    <input type="range" className="ui-range output-volume__slider" min={0} max={max} step={1} value={value}
      disabled={!known || !output.reachable} aria-label="Volume" aria-valuetext={`${value} of ${max}`}
      title={`Up to ${max}, as set in its settings`}
      style={{ '--range-fill': `${max > 0 ? (value / max) * 100 : 0}%` } as React.CSSProperties}
      onChange={event => move(Number(event.target.value))}
      onPointerUp={() => sender.flush()} onKeyUp={() => sender.flush()} onBlur={() => sender.flush()} />
  );

  if (slim) {
    return (
      <div className="output-volume output-volume--slim" role="group" aria-label={`Volume of ${output.name}`}>
        <IconButton size="sm" label={output.muted ? 'Sound on' : 'Mute'} active={output.muted} disabled={!output.reachable}
          onClick={() => outputs.volume(output.id, { muted: !output.muted }).catch(reportOutputError)}>
          {output.muted ? <BsVolumeMuteFill /> : <BsVolumeDownFill />}
        </IconButton>
        {slider}
        <IconButton size="sm" label="Volume up" disabled={!known || !output.reachable || value >= max} onClick={() => move(value + 1, true)}>
          <BsVolumeUpFill />
        </IconButton>
      </div>
    );
  }

  return (
    <div className="output-volume" role="group" aria-label={`Volume of ${output.name}`}>
      <IconButton size="sm" label={output.muted ? 'Sound on' : 'Mute'} active={output.muted} disabled={!output.reachable}
        onClick={() => outputs.volume(output.id, { muted: !output.muted }).catch(reportOutputError)}>
        {output.muted ? <BsVolumeMuteFill /> : <BsVolumeUpFill />}
      </IconButton>
      <IconButton size="sm" label="Volume down" disabled={!known || !output.reachable || value <= 0} onClick={() => move(value - 1, true)}>
        <BsDash />
      </IconButton>
      {slider}
      <IconButton size="sm" label="Volume up" disabled={!known || !output.reachable || value >= max} onClick={() => move(value + 1, true)}>
        <BsPlus />
      </IconButton>
      <span className="output-volume__value" aria-hidden="true">{known ? value : '–'}</span>
    </div>
  );
};

/**
 * The outputs as entries of a menu: this browser and the appliances, the one
 * it plays on with the ✓; under them an appliance's volume and its settings.
 * In the output's own menu, and in the bar's ⋯ on a phone.
 */
export const OutputEntries: React.FC<{ onSettings: (output: Output) => void; volume?: boolean }> = ({ onSettings, volume = true }) => {
  const list = useOutputs();
  const output = usePlayer(state => state.output);
  const localPlaying = usePlayer(state => state.output.kind === 'local' && state.playing);
  const current = output.kind === 'renderer' ? list.find(one => one.id === output.id) ?? null : null;
  return (
    <>
      <Menu.Section title="Output" />
      <Menu.Choice selected={output.kind === 'local'} hint={localPlaying ? 'playing' : undefined}
        onSelect={() => player.setOutput({ kind: 'local' })}>
        {localOutputName()}
      </Menu.Choice>
      {list.map(one => {
        const target: PlayerOutput = { kind: 'renderer', id: one.id, name: one.name };
        return (
          <Menu.Choice key={one.id} value={one.id} selected={sameOutput(output, target)} disabled={!one.reachable && !sameOutput(output, target)}
            hint={outputHint(one)} onSelect={() => player.setOutput(target)}>
            {one.name}
          </Menu.Choice>
        );
      })}
      {current && (
        <>
          <Menu.Separator />
          {volume && <OutputVolume output={current} />}
          <Menu.Item icon={<BsSliders />} onSelect={() => onSettings(current)}>Output settings…</Menu.Item>
        </>
      )}
    </>
  );
};

interface OutputMenuProps {
  /** Another trigger than the bar's speaker: the name of the output, in a pill. */
  trigger?: (props: MenuTriggerProps, open: boolean, output: PlayerOutput) => React.ReactElement;
  drop?: 'up' | 'down';
  align?: 'start' | 'end';
  /** The appliance's volume under the outputs; off where it has its own slider (the phone's full screen). */
  volume?: boolean;
}

/**
 * Where the music plays: this browser (This computer, This iPhone) or an
 * appliance of the house (Salon, Bureau), the one it plays on with a gold ✓,
 * one that does not answer greyed, away. What plays goes along to the one
 * chosen, at the same place. Under them, an appliance's volume and its
 * settings. Nothing when the house has no appliance (UPnP off).
 */
const OutputMenu: React.FC<OutputMenuProps> = ({ trigger, drop = 'up', align = 'end', volume = true }) => {
  const list = useOutputs();
  const output = usePlayer(state => state.output);
  const [settings, setSettings] = useState<Output | null>(null);
  if (list.length === 0) return null;
  const current = output.kind === 'renderer' ? list.find(one => one.id === output.id) ?? null : null;

  return (
    <>
      <Menu drop={drop} align={align} label="Output" className="output-menu" trigger={(props, open) => (trigger ? trigger(props, open, output) : (
        <IconButton {...props} className="player-bar-output" label={current ? `Output: ${current.name}` : 'Output'} active={output.kind === 'renderer'}>
          <BsSpeaker />
        </IconButton>
      ))}>
        <OutputEntries onSettings={setSettings} volume={volume} />
      </Menu>
      {settings && <OutputSettings output={settings} onClose={() => setSettings(null)} />}
    </>
  );
};

export default OutputMenu;
