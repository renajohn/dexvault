import React from 'react';
import { BsGear, BsArrowClockwise, BsArchive, BsBarChart } from 'react-icons/bs';
import Menu from './shared/Menu';
import Spinner from './shared/Spinner';
import './CogDropdown.css';

interface CogDropdownProps {
  onSyncNavidrome?: () => void;
  syncingNavidrome?: boolean;
  onBackup?: () => void;
  onAnalytics?: () => void;
  currentPage?: string;
  /** Off on a phone, where Analytics has its own button among the sections. */
  showAnalytics?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** ⚙︎ in the header: what each collection offers, then what DexVault does for all of them. */
const CogDropdown: React.FC<CogDropdownProps> = ({
  onSyncNavidrome,
  syncingNavidrome = false,
  onBackup,
  onAnalytics,
  currentPage = 'dexvault',
  showAnalytics = true,
  onOpenChange
}) => (
  <div className="cog-dropdown">
    <Menu align="end" label="Menu" onOpenChange={onOpenChange} trigger={props => (
      <button type="button" {...props} className="cog-button" aria-label="Menu">
        <BsGear />
      </button>
    )}>
      {currentPage === 'musicdex' && (
        <>
          <Menu.Section title="MusicDex" />
          <Menu.Item icon={syncingNavidrome ? <Spinner size="sm" /> : <BsArrowClockwise />} disabled={syncingNavidrome} onSelect={onSyncNavidrome}>
            {syncingNavidrome ? 'Reading Navidrome…' : 'Sync Navidrome'}
          </Menu.Item>
          <Menu.Separator />
        </>
      )}
      <Menu.Section title="DexVault" />
      {showAnalytics && <Menu.Item icon={<BsBarChart />} hint="⌘7" onSelect={onAnalytics}>Analytics</Menu.Item>}
      <Menu.Item icon={<BsArchive />} onSelect={onBackup}>Backups</Menu.Item>
    </Menu>
  </div>
);

export default CogDropdown;
