import { describe, expect, it } from 'vitest';
import { getZoneColor, POWER_ZONES } from '../src/constants/powerZones.js';
import { buildTimelineSegments } from '../src/ui/timelineSegments.js';

describe('power zone colors', () => {
  it('uses the requested zone boundaries and exact colors', () => {
    expect(getZoneColor(54).color).toBe('gray');
    expect(getZoneColor(55).color).toBe('blue');
    expect(getZoneColor(75).color).toBe('blue');
    expect(getZoneColor(76).color).toBe('green');
    expect(getZoneColor(90).color).toBe('green');
    expect(getZoneColor(91).color).toBe('yellow');
    expect(getZoneColor(105).color).toBe('yellow');
    expect(getZoneColor(106).color).toBe('red');
    expect(getZoneColor(120).color).toBe('red');
    expect(getZoneColor(121).color).toBe('purple');
    expect(getZoneColor(150).color).toBe('purple');
    expect(getZoneColor(151).color).toBe('black');
    expect(getZoneColor(160).color).toBe('black');
  });

  it('keeps the requested HEX values in the zone CSS contract', () => {
    expect(POWER_ZONES.map((zone) => [zone.key, zone.color])).toEqual([
      ['Z1', 'gray'],
      ['Z2', 'blue'],
      ['Z3', 'green'],
      ['Z4', 'yellow'],
      ['Z5', 'red'],
      ['Z6', 'purple'],
      ['Z7', 'black'],
    ]);
  });

  it('renders a 160% FTP steady interval as the Zone 7 chart color', () => {
    const workout = {
      totalDuration: 120,
      intervals: [
        { type: 'steady', duration: 120, powerStart: 160, powerEnd: 160, cadence: null },
      ],
    };

    expect(buildTimelineSegments(workout)).toEqual([
      {
        type: 'steady',
        intervalIndex: 0,
        startPct: 0,
        widthPct: 100,
        color: 'black',
        startPowerPct: 160,
        endPowerPct: 160,
        bandLayer: undefined,
      },
    ]);
  });
});
