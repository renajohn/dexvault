import { workGroups } from '../src/utils/workGroups';

// The same cases as the frontend's (frontend/src/utils/trackCredits.test.ts): the two copies keep in step.
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

  it('takes for two tracks the longest work they share, and keeps the tracks after it under it while they open with it', () => {
    expect(workGroups([
      'Symphonie G-dur Hob. I: 88: 1. Adagio - Allegro',
      'Symphonie G-dur Hob. I: 88: 3. Menuetto: Allegretto',
      'Symphonie G-dur Hob. I: 92 "Oxford-Symphonie": 1. Adagio - Allegro Spiritoso',
      'Symphonie G-dur Hob. I: 92 "Oxford-Symphonie": 2. Adagio',
      'Symphony no. 9: II. Largo',
      'Symphony no. 9: III: Scherzo: Molto vivace',
      'Requiem d‐moll, KV 626: II. „Kyrie“ (Chor)',
      'Requiem d‐moll, KV 626: III. Sequenz: No. 1. „Dies irae“ (Chor)',
      'Requiem d‐moll, KV 626: III. Sequenz: No. 2.„Tuba mirum“ (Sopran, Alt, Tenor, Bass)',
      'Concerto pour 2 violons BWV 1040 – I',
      'Concerto pour 2 violons BWV 1040 – II',
      'Concerto for Organ, 2 Oboes, Strings and Continuo in G minor, op. 4 no. 1: Adagio',
      'Concerto for Organ, 2 Oboes, Strings and Continuo in G minor, op. 4 No. 1: Andante',
    ]).map(group => group && `${group.first ? '▌' : ' '}${group.work} | ${group.movement}`)).toEqual([
      '▌Symphonie G-dur Hob. I: 88 | 1. Adagio - Allegro',
      ' Symphonie G-dur Hob. I: 88 | 3. Menuetto: Allegretto',
      '▌Symphonie G-dur Hob. I: 92 "Oxford-Symphonie" | 1. Adagio - Allegro Spiritoso',
      ' Symphonie G-dur Hob. I: 92 "Oxford-Symphonie" | 2. Adagio',
      '▌Symphony no. 9 | II. Largo',
      ' Symphony no. 9 | III: Scherzo: Molto vivace',
      '▌Requiem d‐moll, KV 626 | II. „Kyrie“ (Chor)',
      ' Requiem d‐moll, KV 626 | III. Sequenz: No. 1. „Dies irae“ (Chor)',
      ' Requiem d‐moll, KV 626 | III. Sequenz: No. 2.„Tuba mirum“ (Sopran, Alt, Tenor, Bass)',
      '▌Concerto pour 2 violons BWV 1040 | I',
      ' Concerto pour 2 violons BWV 1040 | II',
      '▌Concerto for Organ, 2 Oboes, Strings and Continuo in G minor, op. 4 no. 1 | Adagio',
      ' Concerto for Organ, 2 Oboes, Strings and Continuo in G minor, op. 4 no. 1 | Andante',
    ]);
  });
});
