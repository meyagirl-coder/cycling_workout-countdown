import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHART_SCALE_MODE,
  loadChartScaleMode,
  saveChartScaleMode,
} from '../src/ui/chartScaleModeStore.js';

function makeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = String(value);
    },
  };
}

describe('chartScaleModeStore', () => {
  it('defaults to auto and rejects corrupted saved values', () => {
    expect(loadChartScaleMode(makeStorage())).toBe(DEFAULT_CHART_SCALE_MODE);
    expect(loadChartScaleMode(makeStorage({ 'workout-chart-scale-mode': 'invalid' }))).toBe('auto');
  });

  it.each(['auto', 'fixed'])('round-trips %s', (mode) => {
    const storage = makeStorage();
    saveChartScaleMode(mode, storage);
    expect(loadChartScaleMode(storage)).toBe(mode);
  });

  it('does not save unknown modes', () => {
    expect(() => saveChartScaleMode('large', makeStorage())).toThrow(/invalid mode/);
  });
});
