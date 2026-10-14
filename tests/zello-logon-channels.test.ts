import { describe, expect, it } from 'vitest';

import { MAX_LOGON_CHANNELS, logonChannelList } from '../app/modules/radio-zello/zello-channel';

describe('logonChannelList', () => {
  it('puts the selected channel first and de-duplicates', () => {
    expect(logonChannelList('Ops-1', ['Alpha', 'Ops-1', 'Bravo'])).toEqual(['Ops-1', 'Alpha', 'Bravo']);
  });

  it('ignores blank names and trims whitespace', () => {
    expect(logonChannelList(' Ops-1 ', ['', '  ', 'Alpha '])).toEqual(['Ops-1', 'Alpha']);
  });

  it('caps the list at the Zello Work limit', () => {
    const many = Array.from({ length: 150 }, (_, i) => `ch-${i}`);
    const list = logonChannelList('selected', many);
    expect(list).toHaveLength(MAX_LOGON_CHANNELS);
    expect(list[0]).toBe('selected');
  });

  it('works with no watched channels', () => {
    expect(logonChannelList('Ops-1')).toEqual(['Ops-1']);
  });
});
