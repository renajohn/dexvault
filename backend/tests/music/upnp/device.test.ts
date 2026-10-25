import fs from 'fs';
import path from 'path';
import { actionsOf, loadRenderer, mimeTypesOf, parseDescription } from '../../../src/services/upnp/device';
import { flatXml, secondsOf, soapCall, timeOf, UPnPError, DeviceUnreachableError, envelope } from '../../../src/services/upnp/soap';
import { didlOf, mimeTypeOf } from '../../../src/services/upnp/didl';
import { FakeRenderer } from './fakeRenderer';

const fixture = (file: string) => fs.readFileSync(path.join(__dirname, 'fixtures', file), 'utf8');

describe('an appliance’s description', () => {
  it('gives the Onkyo’s control URLs, its services’ version 2, and its name', () => {
    const onkyo = parseDescription(fixture('onkyo/description.xml'), 'http://192.168.86.47:8888/upnp_descriptor_0')!;
    expect(onkyo).toMatchObject({
      udn: 'uuid:4a11a401-6c01-a4BB-4a70-6c724a11a401', name: 'Salon', manufacturer: 'ONKYO', model: 'TX-RZ70',
      deviceType: 'urn:schemas-upnp-org:device:MediaRenderer:2',
      avTransport: { version: 2, controlUrl: 'http://192.168.86.47:8888/Control/oap/AVTransport', scpdUrl: 'http://192.168.86.47:8888/xml/AVTransport2.xml' },
      renderingControl: { version: 2, controlUrl: 'http://192.168.86.47:8888/Control/oap/RenderingControl' },
      connectionManager: { version: 2, controlUrl: 'http://192.168.86.47:8888/Control/oap/SinkConnectionManager' },
    });
  });

  it('gives the WiiM’s, version 1, its model rather than its firmware date', () => {
    const wiim = parseDescription(fixture('wiim/description.xml'), 'http://192.168.86.20:49152/description.xml')!;
    expect(wiim).toMatchObject({
      udn: 'uuid:FF970016-C1C1-E478-77CC-8CC5FF970016', name: 'Bureau', model: 'WiiM Mini Receiver',
      avTransport: { version: 1, controlUrl: 'http://192.168.86.20:49152/upnp/control/rendertransport1' },
      renderingControl: { version: 1, controlUrl: 'http://192.168.86.20:49152/upnp/control/rendercontrol1' },
      connectionManager: { version: 1, controlUrl: 'http://192.168.86.20:49152/upnp/control/renderconnmgr1' },
    });
  });

  it('reads the Panasonic’s absolute URLs as they are', () => {
    const panasonic = parseDescription(fixture('panasonic/ddd.xml'), 'http://192.168.86.22:60606/FFFFFFFFFFFF/Server0/ddd')!;
    expect(panasonic.avTransport.controlUrl).toBe('http://192.168.86.22:60606/Server0/AVT_control');
    expect(panasonic.name).toBe('DP-UB820/824');
  });

  it('finds SetNextAVTransportURI in the Onkyo’s and the WiiM’s SCPD, not in the Panasonic’s', () => {
    expect(actionsOf(fixture('onkyo/AVTransport2.xml')).has('SetNextAVTransportURI')).toBe(true);
    expect(actionsOf(fixture('wiim/rendertransportSCPD.xml')).has('SetNextAVTransportURI')).toBe(true);
    const panasonic = actionsOf(fixture('panasonic/AVT_SCPD.xml'));
    expect(panasonic.has('SetAVTransportURI')).toBe(true);
    expect(panasonic.has('SetNextAVTransportURI')).toBe(false);
  });

  it('is no MediaRenderer without an AVTransport', () => {
    expect(parseDescription('<root><device><UDN>uuid:x</UDN></device></root>', 'http://x/')).toBeNull();
  });
});

describe('an appliance read over HTTP (the fake one)', () => {
  const fakes: FakeRenderer[] = [];
  afterAll(async () => { await Promise.all(fakes.map(fake => fake.stop())); });

  it.each([
    ['onkyo', true, 'Salon'],
    ['wiim', true, 'Bureau'],
    ['panasonic', false, 'DP-UB820/824'],
  ] as const)('%s: gapless %s', async (kind, gapless, name) => {
    const fake = await new FakeRenderer(kind).start();
    fakes.push(fake);
    const renderer = await loadRenderer(fake.location);
    expect(renderer.description.name).toBe(name);
    expect(renderer.description.avTransport.controlUrl.startsWith(fake.base)).toBe(true);
    expect(renderer.gapless).toBe(gapless);
    expect(renderer.mimeTypes.has('audio/flac')).toBe(true);
    expect(await renderer.getVolume()).toBe(kind === 'wiim' ? 100 : 57);
  });

  it('reads an idle Onkyo as recorded: no media, its last duration kept with an empty URI', async () => {
    const fake = await new FakeRenderer('onkyo').start();
    fakes.push(fake);
    const answer = flatXml(fixture('onkyo/GetPositionInfo.xml'));
    expect(answer).toMatchObject({ TrackDuration: '0:04:06', TrackURI: '', RelTime: '0:00:00' });
    expect(flatXml(fixture('wiim/GetPositionInfo.xml')).AbsTime).toBe('NOT_IMPLEMENTED');
    const renderer = await loadRenderer(fake.location);
    expect(await renderer.transportInfo()).toEqual({ state: 'NO_MEDIA_PRESENT', status: 'OK' });
  });
});

describe('SOAP', () => {
  it('reads times as UPnP writes them', () => {
    expect(secondsOf('0:04:06')).toBe(246);
    expect(secondsOf('00:03:12.500')).toBe(192.5);
    expect(secondsOf('NOT_IMPLEMENTED')).toBe(0);
    expect(timeOf(3723.9)).toBe('1:02:03');
  });

  it('escapes the arguments, a DIDL-Lite among them', () => {
    expect(envelope('urn:x', 'SetAVTransportURI', { CurrentURIMetaData: '<DIDL-Lite>&</DIDL-Lite>' }))
      .toContain('<CurrentURIMetaData>&lt;DIDL-Lite&gt;&amp;&lt;/DIDL-Lite&gt;</CurrentURIMetaData>');
    expect(flatXml('<a><TrackMetaData>&lt;DIDL-Lite&gt;</TrackMetaData></a>').TrackMetaData).toBe('<DIDL-Lite>');
  });

  it('tells a refusal (its errorCode) from no answer', async () => {
    const fake = await new FakeRenderer('wiim').start();
    try {
      const renderer = await loadRenderer(fake.location);
      fake.refuse.set('SetAVTransportURI', 714);
      await expect(renderer.setUri('http://x/1.flac', '')).rejects.toMatchObject({ name: 'UPnPError', code: 714 });
      await expect(renderer.setUri('http://x/1.flac', '')).rejects.toBeInstanceOf(UPnPError);
      fake.down = true;
      await expect(renderer.play()).rejects.toBeInstanceOf(DeviceUnreachableError);
    } finally {
      await fake.stop();
    }
    await expect(soapCall('http://127.0.0.1:1/', 'urn:x', 'Play')).rejects.toBeInstanceOf(DeviceUnreachableError);
  });
});

describe('DIDL-Lite', () => {
  it('names the track, its cover and its type, escaped', () => {
    const didl = didlOf({
      title: 'Lux Æterna & co', artist: 'Ligeti', album: '<Requiem>', trackNumber: 3, durationSec: 246,
      url: 'http://dexvault.lab.crog.org:3002/upnp/stream/abc/s1.flac', mimeType: mimeTypeOf('flac'),
      coverUrl: 'http://dexvault.lab.crog.org:3002/upnp/cover/abc/12.jpg',
    });
    expect(didl).toContain('<dc:title>Lux Æterna &amp; co</dc:title>');
    expect(didl).toContain('<upnp:album>&lt;Requiem&gt;</upnp:album>');
    expect(didl).toContain('protocolInfo="http-get:*:audio/flac:DLNA.ORG_OP=01;DLNA.ORG_FLAGS=01700000000000000000000000000000"');
    expect(didl).toContain('duration="0:04:06.000"');
    expect(didl).toContain('<upnp:class>object.item.audioItem.musicTrack</upnp:class>');
    expect(mimeTypeOf('mp3')).toBe('audio/mpeg');
    expect(mimeTypesOf(flatXml(fixture('wiim/GetProtocolInfo.xml')).Sink).has('audio/flac')).toBe(true);
  });
});
