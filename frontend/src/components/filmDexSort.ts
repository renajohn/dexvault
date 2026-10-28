import type { SortOption } from './shared/CollectionHeader';

// The sorts; on a phone those of a key fold into one entry, their direction as its hint.
export const sortOptions: SortOption[] = [
  { value: 'title', label: 'Title', key: 'Title', direction: 'A-Z' },
  { value: 'titleReverse', label: 'Title - reverse', key: 'Title', direction: 'Z-A' },
  { value: 'lastAddedFirst', label: 'Last acquired first', key: 'Acquired', direction: 'Last first' },
  { value: 'lastAddedLast', label: 'Last acquired last', key: 'Acquired', direction: 'First first' },
  { value: 'rating', label: 'Highest rating first', key: 'Rating', direction: 'Highest' },
  { value: 'ratingLowest', label: 'Lowest rating first', key: 'Rating', direction: 'Lowest' },
  { value: 'ageAsc', label: 'Age - youngest first', key: 'Age', direction: 'Youngest' },
  { value: 'ageDesc', label: 'Age - oldest first', key: 'Age', direction: 'Oldest' }
];
