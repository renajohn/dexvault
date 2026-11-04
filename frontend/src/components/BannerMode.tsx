import React, { useState } from 'react';
import { BsStars } from 'react-icons/bs';
import Segmented from './shared/Segmented';
import { readStored, writeStored } from '../utils/safeStorage';

/** The Listen Next banner's mode, kept in this browser: Listen Next, or the radio. */
export type BannerMode = 'listenNext' | 'radio';
export const BANNER_MODE_KEY = 'dv.listenNext.mode';

export const useBannerMode = (): [BannerMode, (mode: BannerMode) => void] => {
  const [mode, setMode] = useState<BannerMode>(() => (readStored(BANNER_MODE_KEY) === 'radio' ? 'radio' : 'listenNext'));
  const choose = (next: BannerMode) => {
    setMode(next);
    writeStored(BANNER_MODE_KEY, next);
  };
  return [mode, choose];
};

/** `Listen Next | ✦ Radio`, in the banner's head in place of its title. */
export const BannerModeSwitch: React.FC<{ value: BannerMode; onChange: (mode: BannerMode) => void }> = ({ value, onChange }) => (
  <Segmented<BannerMode> label="Listen Next or Radio" className="next-banner__modes" value={value} onChange={onChange}
    options={[
      { value: 'listenNext', label: 'Listen Next' },
      { value: 'radio', icon: <BsStars />, label: 'Radio' },
    ]} />
);
