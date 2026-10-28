import React from 'react';
import Menu, { MenuChevron } from './Menu';
import Button from './Button';
import { BsSortDown, BsGrid3X3Gap, BsPlus, BsEye } from 'react-icons/bs';
import './shared.css';
import Spinner from './Spinner';
import useNarrow from '../../utils/useNarrow';

export interface SortOption {
  value: string;
  label: string;
  /** On a phone, the options of one key are one entry, a second touch turning the order: Title for Title A-Z and Z-A. */
  key?: string;
  /** Which way, said beside the key on a phone: A-Z, Newest. */
  direction?: string;
}

/** A switch of the list's own: a switch on a wide screen, a ✓ in the Show menu on a phone. */
export interface HeaderToggle {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title?: string;
}

interface GroupOption {
  value: string;
  label: string;
}

interface CollectionHeaderProps {
  filteredCount?: number;
  totalCount?: number;
  itemLabel?: string;
  sortBy?: string;
  sortOptions?: SortOption[];
  onSortChange?: (value: string) => void;
  /** While a search's letters are typed: the best match shows first (useBestMatch). */
  bestMatch?: boolean;
  /** Offers "Best match" in the sort's menu, when a search has scored what it found. */
  onBestMatch?: () => void;
  sortLoading?: boolean;
  groupBy?: string;
  groupOptions?: GroupOption[];
  onGroupChange?: (value: string) => void;
  groupLoading?: boolean;
  expandAllGroups?: boolean;
  onToggleAllGroups?: () => void;
  stackEnabled?: boolean;
  onStackChange?: (value: boolean) => void;
  showStackToggle?: boolean;
  addButtonLabel?: string;
  onAdd?: () => void;
  loading?: boolean;
  extraControls?: React.ReactNode;
  /** The list's own switches (Digital, Mixtapes), after Stack. */
  toggles?: HeaderToggle[];
  /** Beside the count, at the right end: a button that acts on the whole list, say. */
  countExtra?: React.ReactNode;
  /** First in the controls: which view of the section (BookDex's Library and Reading). */
  leading?: React.ReactNode;
}

const CollectionHeader: React.FC<CollectionHeaderProps> = ({
  filteredCount = 0,
  totalCount = 0,
  itemLabel = 'items',
  sortBy,
  sortOptions = [],
  onSortChange,
  bestMatch = false,
  onBestMatch,
  sortLoading = false,
  groupBy = 'none',
  groupOptions = [],
  onGroupChange,
  groupLoading = false,
  expandAllGroups = false,
  onToggleAllGroups,
  stackEnabled = true,
  onStackChange,
  showStackToggle,
  addButtonLabel = 'Add Item',
  onAdd,
  loading = false,
  extraControls,
  toggles = [],
  countExtra,
  leading
}) => {
  const narrow = useNarrow();
  // Default: show stack toggle when no grouping is active
  const shouldShowStackToggle = showStackToggle !== undefined
    ? showStackToggle
    : (groupBy === 'none' && onStackChange);

  const currentSortLabel = bestMatch ? 'Best match' : sortOptions.find(opt => opt.value === sortBy)?.label || 'Sort';
  const currentGroupLabel = groupOptions.find(opt => opt.value === groupBy)?.label || 'No grouping';
  const allToggles: HeaderToggle[] = [
    ...(shouldShowStackToggle ? [{ label: 'Stack', checked: stackEnabled, onChange: (on: boolean) => onStackChange && onStackChange(on) }] : []),
    ...toggles,
  ];

  if (narrow) return (
    <NarrowHeader
      count={filteredCount === totalCount ? `${totalCount} ${itemLabel}` : `${filteredCount} of ${totalCount}`}
      sortBy={sortBy} sortOptions={sortOptions} onSortChange={onSortChange} bestMatch={bestMatch} onBestMatch={onBestMatch}
      sortLoading={loading || sortLoading}
      groupBy={groupBy} groupOptions={groupOptions} onGroupChange={onGroupChange} groupLoading={loading || groupLoading}
      expandAllGroups={expandAllGroups} onToggleAllGroups={onToggleAllGroups}
      toggles={allToggles} addButtonLabel={addButtonLabel} onAdd={onAdd}
      extraControls={extraControls} countExtra={countExtra} leading={leading}
    />
  );

  return (
    <div className="collection-header">
      <div className="collection-controls">
        {leading}

        {/* Sort */}
        {sortOptions.length > 0 && (
          <Menu label="Sort" trigger={(props, open) => (
            <button type="button" {...props}
              className={`menu-pill sort-dropdown-button ${loading || sortLoading ? 'filter-pill-loading' : ''}`}
              disabled={sortLoading}>
              {sortLoading ? (
                <>
                  <Spinner size="sm" />
                  Sorting...
                </>
              ) : (
                <>
                  <span className="menu-pill__lead"><BsSortDown /></span>
                  <span className="menu-pill__muted">Sort:</span> {currentSortLabel}
                  <MenuChevron open={open} />
                </>
              )}
            </button>
          )}>
            {onBestMatch && (
              <>
                <Menu.Choice selected={bestMatch} onSelect={onBestMatch}>Best match</Menu.Choice>
                <Menu.Separator />
              </>
            )}
            {sortOptions.map(option => (
              <Menu.Choice key={option.value} selected={!bestMatch && sortBy === option.value} onSelect={() => onSortChange && onSortChange(option.value)}>
                {option.label}
              </Menu.Choice>
            ))}
          </Menu>
        )}

        {/* Grouping */}
        {groupOptions.length > 0 && (
          <Menu label="Grouping" trigger={(props, open) => (
            <button type="button" {...props}
              className={`menu-pill group-dropdown-button ${loading || groupLoading ? 'filter-pill-loading' : ''}`}
              disabled={groupLoading}>
              {groupLoading ? (
                <>
                  <Spinner size="sm" />
                  Grouping...
                </>
              ) : (
                <>
                  <span className="menu-pill__lead"><BsGrid3X3Gap /></span>
                  {currentGroupLabel}
                  <MenuChevron open={open} />
                </>
              )}
            </button>
          )}>
            {groupOptions.map(option => (
              <Menu.Choice key={option.value} selected={groupBy === option.value} onSelect={() => onGroupChange && onGroupChange(option.value)}>
                {option.label}
              </Menu.Choice>
            ))}
          </Menu>
        )}

        {/* Collapse All Button - Only show when grouping is enabled */}
        {groupBy !== 'none' && onToggleAllGroups && (
          <Button variant="quiet" size="sm" className="collapse-all-btn" onClick={onToggleAllGroups}>
            {expandAllGroups ? 'Collapse All' : 'Expand All'}
          </Button>
        )}

        {/* Stack Toggle */}
        {shouldShowStackToggle && (
          <div className="stack-toggle-container">
            <span className="stack-toggle-label">Stack</span>
            <label className="stack-toggle-switch">
              <input
                type="checkbox"
                checked={stackEnabled}
                onChange={(e) => onStackChange && onStackChange(e.target.checked)}
              />
              <span className="stack-toggle-slider"></span>
            </label>
          </div>
        )}

        {toggles.map(toggle => (
          <label key={toggle.label} className="stack-toggle-container" title={toggle.title}>
            <span className="stack-toggle-label">{toggle.label}</span>
            <span className="stack-toggle-switch">
              <input type="checkbox" checked={toggle.checked} onChange={event => toggle.onChange(event.target.checked)} aria-label={toggle.label} />
              <span className="stack-toggle-slider"></span>
            </span>
          </label>
        ))}

        {/* Extra Controls */}
        {extraControls}

        {/* Add Button */}
        {onAdd && (
          <Button variant="primary" size="sm" icon={<BsPlus />} className="add-item-btn" onClick={onAdd}>
            {addButtonLabel}
          </Button>
        )}
      </div>

      {/* Item Count */}
      <div className="collection-count">
        Showing {filteredCount} of {totalCount} {itemLabel}
        {countExtra}
      </div>
    </div>
  );
};

/** The sort's entries on a phone: one per key, the options of a key folded into it. */
const sortEntries = (options: SortOption[]): Array<{ key: string; label: string; options: SortOption[] }> => {
  const entries: Array<{ key: string; label: string; options: SortOption[] }> = [];
  for (const option of options) {
    const key = option.key ?? option.value;
    const entry = entries.find(e => e.key === key);
    if (entry) entry.options.push(option);
    else entries.push({ key, label: option.key ?? option.label, options: [option] });
  }
  return entries;
};

interface NarrowHeaderProps {
  count: string;
  sortBy?: string;
  sortOptions: SortOption[];
  onSortChange?: (value: string) => void;
  bestMatch: boolean;
  onBestMatch?: () => void;
  sortLoading: boolean;
  groupBy: string;
  groupOptions: GroupOption[];
  onGroupChange?: (value: string) => void;
  groupLoading: boolean;
  expandAllGroups: boolean;
  onToggleAllGroups?: () => void;
  toggles: HeaderToggle[];
  addButtonLabel: string;
  onAdd?: () => void;
  extraControls?: React.ReactNode;
  countExtra?: React.ReactNode;
  leading?: React.ReactNode;
}

/**
 * On a phone, one line: the count, then the sort, the grouping and what to show
 * as icons opening their menus, and + to add. The view's switch, when there is one, above.
 */
const NarrowHeader: React.FC<NarrowHeaderProps> = ({
  count, sortBy, sortOptions, onSortChange, bestMatch, onBestMatch, sortLoading,
  groupBy, groupOptions, onGroupChange, groupLoading, expandAllGroups, onToggleAllGroups,
  toggles, addButtonLabel, onAdd, extraControls, countExtra, leading,
}) => {
  const choose = (entry: { options: SortOption[] }) => {
    const at = entry.options.findIndex(option => option.value === sortBy);
    // A key chosen again turns its order; another starts at its first.
    const next = !bestMatch && at >= 0 ? entry.options[(at + 1) % entry.options.length] : entry.options[0];
    if (onSortChange) onSortChange(next.value);
  };
  return (
    <div className="collection-header collection-header--narrow">
      {leading && <div className="collection-header__leading">{leading}</div>}
      <div className="collection-controls">
        <span className="collection-count">{count}</span>
        {countExtra}
        {extraControls}
        <span className="collection-header__icons">
          {sortOptions.length > 0 && (
            <Menu label="Sort" align="end" trigger={(props, open) => (
              <button type="button" {...props} className="menu-pill menu-pill--icon sort-dropdown-button"
                title="Sort" aria-label="Sort" disabled={sortLoading}>
                {sortLoading ? <Spinner size="sm" /> : <BsSortDown />}
                <MenuChevron open={open} />
              </button>
            )}>
              {onBestMatch && (
                <>
                  <Menu.Choice selected={bestMatch} onSelect={onBestMatch}>Best match</Menu.Choice>
                  <Menu.Separator />
                </>
              )}
              {sortEntries(sortOptions).map(entry => {
                const current = bestMatch ? undefined : entry.options.find(option => option.value === sortBy);
                const turns = entry.options.length > 1;
                return (
                  <Menu.Choice key={entry.key} selected={!!current} onSelect={() => choose(entry)}
                    hint={turns ? (current ?? entry.options[0]).direction : undefined}
                    title={turns && current ? 'Touch again to turn the order' : undefined}>
                    {entry.label}
                  </Menu.Choice>
                );
              })}
            </Menu>
          )}

          {groupOptions.length > 0 && (
            <Menu label="Grouping" align="end" trigger={(props, open) => (
              <button type="button" {...props}
                className={`menu-pill menu-pill--icon group-dropdown-button ${groupBy !== 'none' ? 'menu-pill--on' : ''}`}
                title="Grouping" aria-label="Grouping" disabled={groupLoading}>
                {groupLoading ? <Spinner size="sm" /> : <BsGrid3X3Gap />}
                <MenuChevron open={open} />
              </button>
            )}>
              {groupOptions.map(option => (
                <Menu.Choice key={option.value} selected={groupBy === option.value} onSelect={() => onGroupChange && onGroupChange(option.value)}>
                  {option.label}
                </Menu.Choice>
              ))}
              {groupBy !== 'none' && onToggleAllGroups && (
                <>
                  <Menu.Separator />
                  <Menu.Item onSelect={onToggleAllGroups}>{expandAllGroups ? 'Collapse All' : 'Expand All'}</Menu.Item>
                </>
              )}
            </Menu>
          )}

          {toggles.length > 0 && (
            <Menu label="Show" align="end" trigger={(props, open) => (
              <button type="button" {...props} className="menu-pill menu-pill--icon show-dropdown-button" title="Show" aria-label="Show">
                <BsEye />
                <MenuChevron open={open} />
              </button>
            )}>
              <Menu.Section title="Show" />
              {toggles.map(toggle => (
                <Menu.Choice key={toggle.label} selected={toggle.checked} title={toggle.title} onSelect={() => toggle.onChange(!toggle.checked)}>
                  {toggle.label}
                </Menu.Choice>
              ))}
            </Menu>
          )}

          {onAdd && (
            <Button variant="primary" size="sm" icon={<BsPlus />} className="add-item-btn add-item-btn--icon"
              aria-label={addButtonLabel} title={addButtonLabel} onClick={onAdd} />
          )}
        </span>
      </div>
    </div>
  );
};

export default CollectionHeader;
