import net from 'net';

/**
 * Onkyo's own remote control, eISCP, on TCP 60128: whether the receiver is
 * on or in standby, which input it is on, and turning it on to NET. UPnP
 * cannot tell standby from on, nor switch the receiver on: played at in
 * standby, the Onkyo woke by itself, then dropped off the network for half a
 * minute to four. Turned on this way it says when it is on, and on NET.
 *
 * One short connection per question, as the Onkyo's app does not mind.
 * A message: "ISCP", the header's size, the data's size (big-endian), the
 * version, three bytes reserved; then "!1" (a receiver), the command, CR.
 */

export const ISCP_PORT = 60128;
const TIMEOUT_MS = 2500;
/** After PWR01 the Onkyo takes a moment before it hears an input chosen. */
const INPUT_TRIES = 8;
const INPUT_EVERY_MS = 500;

/** The input's code for NET (streaming, DLNA): where DexVault plays. */
export const NET_INPUT = '2B';

/** The inputs of a TX-RZ70, by their code, as its front panel names them. */
const INPUT_NAMES: Record<string, string> = {
  '00': 'VCR/DVR', '01': 'CBL/SAT', '02': 'Game', '03': 'AUX', '05': 'PC', '10': 'BD/DVD', '11': 'Streaming box',
  '12': 'TV', '22': 'Phono', '23': 'CD', '24': 'FM', '25': 'AM', '26': 'Tuner', '29': 'USB', '2B': 'NET', '2E': 'Bluetooth',
};

/** An input's name; a code it does not know stays a code. */
export const inputName = (code: string | null): string | null => (code == null ? null : INPUT_NAMES[code.toUpperCase()] ?? `input ${code}`);

export interface PowerStatus {
  power: 'on' | 'standby';
  /** The input's code ("2B"); null when it would not say (in standby). */
  input: string | null;
}

/** What turns an appliance on, tells whether it is, and puts it back in standby. */
export interface PowerControl {
  status(): Promise<PowerStatus | null>;
  /** On, and on NET; resolved once it says so. */
  turnOn(): Promise<void>;
  /** On NET, from another input. */
  selectNet(): Promise<void>;
  standby(): Promise<void>;
}

export const packet = (command: string): Buffer => {
  const body = Buffer.from(`!1${command}\r`);
  const header = Buffer.alloc(16);
  header.write('ISCP', 0, 'ascii');
  header.writeUInt32BE(16, 4);
  header.writeUInt32BE(body.length, 8);
  header[12] = 1;
  return Buffer.concat([header, body]);
};

/** The messages in what the receiver sent: "PWR01", "SLI2B", "NTM00:01:02/00:09:33"… */
export const messagesOf = (data: Buffer): string[] => {
  const messages: string[] = [];
  let at = 0;
  while (at + 16 <= data.length && data.toString('ascii', at, at + 4) === 'ISCP') {
    const headerSize = data.readUInt32BE(at + 4);
    const dataSize = data.readUInt32BE(at + 8);
    if (at + headerSize + dataSize > data.length) break;
    const text = data.toString('latin1', at + headerSize, at + headerSize + dataSize).replace(/[\x1a\r\n]+$/g, '');
    if (text.startsWith('!1')) messages.push(text.slice(2));
    at += headerSize + dataSize;
  }
  return messages;
};

export class Iscp implements PowerControl {
  readonly host: string;
  readonly port: number;

  constructor(host: string, port = ISCP_PORT) {
    this.host = host;
    this.port = port;
  }

  /**
   * Commands sent, and the receiver's messages of `wanted` (by their prefix:
   * "PWR", "SLI") read until it has said all it had to (`complete`); on a
   * timeout, what was heard if it is `enough`, else null.
   */
  exchange(
    commands: string[], wanted: string[],
    complete = (heard: Map<string, string>) => wanted.every(prefix => heard.has(prefix)),
    enough = complete,
  ): Promise<Map<string, string> | null> {
    return new Promise(resolve => {
      const heard = new Map<string, string>();
      let buffer = Buffer.alloc(0);
      let done = false;
      const socket = net.connect(this.port, this.host);
      const finish = (answer: Map<string, string> | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(answer);
      };
      const settle = () => finish(enough(heard) ? heard : null);
      const timer = setTimeout(settle, TIMEOUT_MS);
      timer.unref?.();
      socket.on('connect', () => socket.write(Buffer.concat(commands.map(packet))));
      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        for (const message of messagesOf(buffer)) {
          for (const prefix of wanted) if (message.startsWith(prefix)) heard.set(prefix, message.slice(prefix.length));
        }
        // Whole messages read: the rest kept for the next chunk.
        let at = 0;
        while (at + 16 <= buffer.length && buffer.toString('ascii', at, at + 4) === 'ISCP') {
          const size = buffer.readUInt32BE(at + 4) + buffer.readUInt32BE(at + 8);
          if (at + size > buffer.length) break;
          at += size;
        }
        buffer = buffer.subarray(at);
        if (complete(heard)) finish(heard);
      });
      socket.on('error', () => finish(null));
      socket.on('close', settle);
    });
  }

  async status(): Promise<PowerStatus | null> {
    // In standby its input does not matter, and it may not say it: its power is enough.
    const heard = await this.exchange(['PWRQSTN', 'SLIQSTN'], ['PWR', 'SLI'],
      said => said.has('PWR') && (said.get('PWR') !== '01' || said.has('SLI')), said => said.has('PWR'));
    if (!heard) return null;
    // In standby an input may not be told: "N/A".
    const input = heard.get('SLI');
    return { power: heard.get('PWR') === '01' ? 'on' : 'standby', input: input && /^[0-9A-F]{2}$/i.test(input) ? input.toUpperCase() : null };
  }

  async turnOn(): Promise<void> {
    const on = await this.exchange(['PWR01'], ['PWR']);
    if (on?.get('PWR') !== '01') throw new Error(`${this.host} would not turn on`);
    await this.selectNet();
  }

  async selectNet(): Promise<void> {
    for (let tries = 0; tries < INPUT_TRIES; tries++) {
      const heard = await this.exchange([`SLI${NET_INPUT}`], ['SLI']);
      if (heard?.get('SLI')?.toUpperCase() === NET_INPUT) return;
      await new Promise(resolve => setTimeout(resolve, INPUT_EVERY_MS));
    }
    throw new Error(`${this.host} would not go to NET`);
  }

  async standby(): Promise<void> {
    await this.exchange(['PWR00'], ['PWR']);
  }
}

/** Whether an appliance speaks eISCP: Onkyo's, Pioneer's and Integra's receivers. */
export const speaksIscp = (manufacturer: string | undefined | null): boolean => /onkyo|pioneer|integra/i.test(manufacturer ?? '');
