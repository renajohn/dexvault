/**
 * The radio's styles as neighbours, learnt from the fiches: two styles are
 * close when the same artists play both. Each style is a vector over the
 * artists (how many of the artist's recordings carry it), two styles as
 * close as the cosine of theirs; then a style reaches another through those
 * between, the weight of a path the product of its steps', the best path
 * kept (jazz → singer-songwriter → folk). A style is itself at 1.
 */

export interface StyleGraph {
  /** How close `to` is to `from`, 0 to 1; 1 for itself. */
  weight: (from: string, to: string) => number;
  /** The styles from `from` to `to` along the best path, both ends in; empty when there is none. */
  path: (from: string, to: string) => string[];
  styles: string[];
}

export interface FichedRecording {
  /** The recording's key: a recording on two albums counts once. */
  key: string;
  /** Who it is by, as the radio's artist rules tell it. */
  artist: string;
  styles: string[];
}

export const buildStyleGraph = (recordings: Iterable<FichedRecording>): StyleGraph => {
  const seen = new Set<string>();
  const vectors = new Map<string, Map<string, number>>();
  for (const { key, artist, styles } of recordings) {
    if (seen.has(key)) continue;
    seen.add(key);
    for (const style of new Set(styles)) {
      if (!vectors.has(style)) vectors.set(style, new Map());
      const vector = vectors.get(style)!;
      vector.set(artist, (vector.get(artist) || 0) + 1);
    }
  }
  const styles = [...vectors.keys()].sort();
  const at = new Map(styles.map((style, i) => [style, i]));
  const n = styles.length;
  const norms = styles.map(style => Math.sqrt([...vectors.get(style)!.values()].reduce((sum, count) => sum + count * count, 0)));
  const weights = styles.map(() => new Array<number>(n).fill(0));
  // The next step on the best path from i to j.
  const nextOf = styles.map(() => new Array<number>(n).fill(-1));
  for (let i = 0; i < n; i++) {
    weights[i][i] = 1;
    nextOf[i][i] = i;
    for (let j = i + 1; j < n; j++) {
      const [small, large] = vectors.get(styles[i])!.size < vectors.get(styles[j])!.size
        ? [vectors.get(styles[i])!, vectors.get(styles[j])!] : [vectors.get(styles[j])!, vectors.get(styles[i])!];
      let dot = 0;
      for (const [artist, count] of small) dot += count * (large.get(artist) || 0);
      const cosine = norms[i] && norms[j] ? dot / (norms[i] * norms[j]) : 0;
      if (cosine > 0) {
        weights[i][j] = weights[j][i] = cosine;
        nextOf[i][j] = j;
        nextOf[j][i] = i;
      }
    }
  }
  // Floyd–Warshall, the product in place of the sum and the most in place of the least.
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      if (!weights[i][k]) continue;
      for (let j = 0; j < n; j++) {
        const through = weights[i][k] * weights[k][j];
        if (through > weights[i][j]) {
          weights[i][j] = through;
          nextOf[i][j] = nextOf[i][k];
        }
      }
    }
  }
  return {
    styles,
    weight: (from, to) => {
      if (from === to) return 1;
      const i = at.get(from);
      const j = at.get(to);
      return i === undefined || j === undefined ? 0 : weights[i][j];
    },
    path: (from, to) => {
      if (from === to) return [from];
      let i = at.get(from);
      const j = at.get(to);
      if (i === undefined || j === undefined || nextOf[i][j] === -1) return [];
      const path = [from];
      while (i !== j) {
        i = nextOf[i!][j];
        path.push(styles[i!]);
      }
      return path;
    },
  };
};
