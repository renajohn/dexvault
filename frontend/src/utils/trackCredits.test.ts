import { describe, it, expect } from 'vitest';
import { trackCredits, discCredits, workGroups } from './trackCredits';

const vivaldi = {
  artist: ['Antonio Vivaldi'],
  composers: ['Antonio Vivaldi'],
  performers: [{ name: 'Paul Sacher', role: 'conductor' }, { name: 'Mstislav Rostropovich', role: 'cello' }],
};

describe('trackCredits', () => {
  it('nomme le compositeur puis les interprètes avec leur rôle', () => {
    expect(trackCredits(vivaldi, [])).toBe('Antonio Vivaldi — Paul Sacher (conductor), Mstislav Rostropovich (cello)');
  });

  it('tait l’artiste de la piste quand c’est celui de l’album', () => {
    expect(trackCredits({ artist: ['Massive Attack'] }, ['Massive Attack'])).toBeNull();
  });

  it('tait l’interprète qui est l’artiste de l’album', () => {
    expect(trackCredits({
      composers: ['Edvard Grieg'],
      performers: [{ name: 'Alceo Galliera', role: 'conductor' }, { name: 'Dinu Lipatti', role: 'piano' }],
    }, ['Dinu Lipatti'])).toBe('Edvard Grieg — Alceo Galliera (conductor)');
  });

  it('nomme l’artiste d’une piste de compilation', () => {
    expect(trackCredits({ artist: ['Horace Andy'] }, ['Massive Attack'])).toBe('Horace Andy');
  });
});

describe('discCredits', () => {
  const sinopoli = [{ name: 'Giuseppe Sinopoli', role: 'conductor' }, { name: 'Philharmonia Orchestra', role: 'orchestra' }];
  const carreras = { name: 'José Carreras', role: 'tenor vocals' };
  const freni = { name: 'Mirella Freni', role: 'soprano vocals' };

  it('écrit une fois en tête ce que toutes les pistes partagent, puis les chanteurs sous chaque piste', () => {
    const tracks = [
      { composers: ['Giacomo Puccini'], performers: [...sinopoli, carreras] },
      { composers: ['Giacomo Puccini'], performers: [...sinopoli, carreras] },
      { composers: ['Giacomo Puccini'], performers: [...sinopoli, freni] },
    ];

    expect(discCredits(tracks, [])).toEqual({
      common: 'Giacomo Puccini — Giuseppe Sinopoli (conductor), Philharmonia Orchestra (orchestra)',
      perTrack: ['José Carreras (tenor vocals)', 'José Carreras (tenor vocals)', 'Mirella Freni (soprano vocals)'],
      musicians: [null, null, null],
    });
  });

  it('nomme le compositeur sous chaque mouvement quand aucun ne domine le disque', () => {
    const boccherini = { ...vivaldi, composers: ['Luigi Boccherini'] };

    expect(discCredits([boccherini, boccherini, vivaldi, vivaldi], [])).toEqual({
      common: 'Paul Sacher (conductor), Mstislav Rostropovich (cello)',
      perTrack: ['Luigi Boccherini', 'Luigi Boccherini', 'Antonio Vivaldi', 'Antonio Vivaldi'],
      musicians: [null, null, null, null],
    });
  });

  it('ne répète pas sous chaque piste le compositeur déjà nommé en tête', () => {
    const sonata = { artist: ['Ludwig van Beethoven'], composers: ['Ludwig van Beethoven'], performers: [{ name: 'Wilhelm Kempff', role: 'piano' }] };
    expect(discCredits([sonata, sonata], ['Wilhelm Kempff']).perTrack).toEqual([null, null]);
  });

  it('met en tête l’auteur de la plupart des pistes, et l’autre sous la sienne', () => {
    const lennon = { artist: ['The Beatles'], composers: ['John Lennon', 'Paul McCartney'] };
    const harrison = { artist: ['The Beatles'], composers: ['George Harrison'] };

    expect(discCredits([lennon, harrison, lennon], ['The Beatles'])).toMatchObject({
      common: 'John Lennon / Paul McCartney', perTrack: [null, 'George Harrison', null],
    });
  });

  it('ne prend pas une piste sans crédits pour un autre compositeur', () => {
    const song = { artist: ['Steely Dan'], composers: ['Walter Becker', 'Donald Fagen'] };
    const blackCow = { artist: ['Steely Dan'], composers: [] };

    expect(discCredits([blackCow, song, song], ['Steely Dan'])).toEqual({
      common: 'Walter Becker / Donald Fagen', perTrack: [null, null, null], musicians: [null, null, null],
    });
  });

  it('se tait sans crédits', () => {
    expect(discCredits([{ artist: ['Massive Attack'] }], ['Massive Attack'])).toEqual({ common: null, perTrack: [null], musicians: [null] });
  });

  it('range les musiciens d’un groupe à part, une personne avec tous ses instruments', () => {
    const track = { artist: ['Adele'], performers: [
      { name: 'Ryan Tedder', role: 'drums (drum set)' }, { name: 'Ryan Tedder', role: 'piano' },
      { name: 'Adele Laurie Blue Adkins', role: 'lead vocals' },
      { name: 'Oren Waters', role: 'chorus master' },
    ] };

    expect(discCredits([track], ['Adele'])).toEqual({
      common: null,
      perTrack: [null],
      musicians: ['Ryan Tedder (drums (drum set), piano), Adele Laurie Blue Adkins (lead vocals), Oren Waters (chorus master)'],
    });
  });

  it('garde les solistes d’un concerto, mais pas l’orchestre entier pupitre par pupitre', () => {
    const sections = ['violin', 'viola', 'cello', 'double bass'].map((role, i) => ({ name: `Player ${i}`, role }));
    const [many] = [discCredits([{ performers: [{ name: 'Karajan', role: 'conductor' }, ...sections] }], [])];
    expect(many.common).toBe('Karajan (conductor)');
    expect(many.musicians[0]).toContain('Player 3 (double bass)');
  });
});

describe('workGroups', () => {
  it('puts the movements of a work under it, and leaves alone a piece on its own', () => {
    expect(workGroups([
      '24 Préludes, op. 28 no. 1 in C major: Agitato',
      '24 Préludes, op. 28 no. 2 in A minor: Lento',
      'Piano Sonata no. 2 in B‐flat minor: op. 35: I. Grave – Doppio movimento',
      'Piano Sonata no. 2 in B‐flat minor: op. 35: II. Scherzo',
      'Come Together',
    ])).toEqual([
      null,
      null,
      { work: 'Piano Sonata no. 2 in B‐flat minor: op. 35', movement: 'I. Grave – Doppio movimento', first: true },
      { work: 'Piano Sonata no. 2 in B‐flat minor: op. 35', movement: 'II. Scherzo', first: false },
      null,
    ]);
  });

  it('reads a rip\'s " _ " for a colon, a colon or a dash before a movement\'s number, and tracks of one title as its parts', () => {
    expect(workGroups([
      "Sonata no.4 in e flat _ 3. allegro",
      "Sonata no.4 in e flat _ rondo. poco allegretto e grazioso",
      "Sonata no.8 in c minor, op. 13 - 'pathetique' _ 1. grave-allegro di molto e con brio",
      "Sonata no.8 in c minor, op. 13 - 'pathetique' _ 2. adagio cantabile",
      "Sonata no.17 in d op.31 no.2 'the tempest' - 1. largo allegro",
      "Sonata no.17 in d op.31 no.2 'the tempest' - 2. adagio",
      'Sonata No. 7 In D Major, Op. 10 No. 3 - 3. Menuetto, Allegro',
      'Sonata No. 7 In D Major, Op. 10 No. 3 - 4, Rondo. Allegro',
      'Sonata no.23 in f minor, op. 57',
      'Sonata no.23 in f minor, op. 57',
      'Sonata no.24 in f sharp major, op. 78',
      'Sonata no.24 in f sharp major, op. 78',
      'Suite no. 1 for 2 pianos, op. 5: I. Barcarolle: Allegretto',
      "Suite no. 1 for 2 pianos, op. 5: II. La Nuit, l'Amour: Adagio sostenuto",
      'Hey Jude - 2015 Remaster',
      'Let It Be - 2015 Remaster',
    ])).toEqual([
      { work: 'Sonata no.4 in e flat', movement: '3. allegro', first: true },
      { work: 'Sonata no.4 in e flat', movement: 'rondo. poco allegretto e grazioso', first: false },
      { work: "Sonata no.8 in c minor, op. 13 - 'pathetique'", movement: '1. grave-allegro di molto e con brio', first: true },
      { work: "Sonata no.8 in c minor, op. 13 - 'pathetique'", movement: '2. adagio cantabile', first: false },
      { work: "Sonata no.17 in d op.31 no.2 'the tempest'", movement: '1. largo allegro', first: true },
      { work: "Sonata no.17 in d op.31 no.2 'the tempest'", movement: '2. adagio', first: false },
      { work: 'Sonata No. 7 In D Major, Op. 10 No. 3', movement: '3. Menuetto, Allegro', first: true },
      { work: 'Sonata No. 7 In D Major, Op. 10 No. 3', movement: '4, Rondo. Allegro', first: false },
      { work: 'Sonata no.23 in f minor, op. 57', movement: 'Part 1', first: true },
      { work: 'Sonata no.23 in f minor, op. 57', movement: 'Part 2', first: false },
      { work: 'Sonata no.24 in f sharp major, op. 78', movement: 'Part 1', first: true },
      { work: 'Sonata no.24 in f sharp major, op. 78', movement: 'Part 2', first: false },
      { work: 'Suite no. 1 for 2 pianos, op. 5', movement: 'I. Barcarolle: Allegretto', first: true },
      { work: 'Suite no. 1 for 2 pianos, op. 5', movement: "II. La Nuit, l'Amour: Adagio sostenuto", first: false },
      null,
      null,
    ]);
  });
});
