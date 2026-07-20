import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { parseZwoXml } from '../src/parser/zwoParser.js';
import { workoutSchema } from '../src/schema/workoutSchema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');

const ajv = new Ajv();
const validateWorkout = ajv.compile(workoutSchema);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function loadFixture(filename) {
  return readFileSync(join(FIXTURES_DIR, filename), 'utf-8');
}

function expectValidWorkout(workout) {
  const valid = validateWorkout(workout);
  if (!valid) {
    throw new Error(`Workout failed schema validation: ${JSON.stringify(validateWorkout.errors, null, 2)}`);
  }
}

describe('parseZwoXml', () => {
  it('parses a basic warmup/steady/cooldown workout and matches the schema', () => {
    const workout = parseZwoXml(loadFixture('basic_warmup_steady_cooldown.zwo'));

    expectValidWorkout(workout);
    expect(workout.id).toMatch(UUID_RE);
    expect(workout.name).toBe('Basic SST Session');
    expect(workout.source).toBe('zwo');
    expect(workout.totalDuration).toBe(600 + 720 + 300);

    expect(workout.intervals).toEqual([
      { type: 'warmup', duration: 600, powerStart: 50, powerEnd: 70, cadence: null },
      { type: 'steady', duration: 720, powerStart: 88, powerEnd: 88, cadence: 90 },
      { type: 'cooldown', duration: 300, powerStart: 70, powerEnd: 50, cadence: null },
    ]);
  });

  it('parses ramp and freeride segments, keeping freeride power null', () => {
    const workout = parseZwoXml(loadFixture('ramp_and_freeride.zwo'));

    expectValidWorkout(workout);
    expect(workout.name).toBe('Ramp Builder with Recovery');
    expect(workout.totalDuration).toBe(300 + 300 + 180 + 240 + 300);

    expect(workout.intervals).toEqual([
      { type: 'warmup', duration: 300, powerStart: 40, powerEnd: 60, cadence: null },
      { type: 'ramp', duration: 300, powerStart: 60, powerEnd: 100, cadence: null },
      { type: 'freeride', duration: 180, powerStart: null, powerEnd: null, cadence: null },
      { type: 'ramp', duration: 240, powerStart: 100, powerEnd: 60, cadence: 85 },
      { type: 'cooldown', duration: 300, powerStart: 60, powerEnd: 40, cadence: null },
    ]);
  });

  it('parses a multi-rep SST workout (SST 3x12) with correct total duration and interval count', () => {
    const workout = parseZwoXml(loadFixture('sst_3x12.zwo'));

    expectValidWorkout(workout);
    expect(workout.name).toBe('SST 3x12');
    expect(workout.intervals).toHaveLength(7);
    expect(workout.totalDuration).toBe(600 + 720 + 300 + 720 + 300 + 720 + 600);

    const steadyIntervals = workout.intervals.filter((iv) => iv.type === 'steady');
    expect(steadyIntervals).toHaveLength(3);
    for (const iv of steadyIntervals) {
      expect(iv).toEqual({ type: 'steady', duration: 720, powerStart: 88, powerEnd: 88, cadence: 90 });
    }

    const freerideIntervals = workout.intervals.filter((iv) => iv.type === 'freeride');
    expect(freerideIntervals).toHaveLength(2);
    for (const iv of freerideIntervals) {
      expect(iv.powerStart).toBeNull();
      expect(iv.powerEnd).toBeNull();
    }
  });

  it('generates a unique id on every parse', () => {
    const xml = loadFixture('basic_warmup_steady_cooldown.zwo');
    const first = parseZwoXml(xml);
    const second = parseZwoXml(xml);
    expect(first.id).not.toBe(second.id);
  });

  it('falls back to "Untitled Workout" when <name> is missing', () => {
    const xml = `<workout_file>
      <workout>
        <SteadyState Duration="60" Power="0.5"/>
      </workout>
    </workout_file>`;

    const workout = parseZwoXml(xml);
    expectValidWorkout(workout);
    expect(workout.name).toBe('Untitled Workout');
  });

  it('throws on malformed XML', () => {
    expect(() => parseZwoXml('<workout_file><workout>')).toThrow(/Invalid ZWO XML/);
  });

  it('throws when the <workout_file> root element is missing', () => {
    expect(() => parseZwoXml('<not_a_workout></not_a_workout>')).toThrow(/missing <workout_file>/);
  });

  it('throws when the <workout> element is missing', () => {
    const xml = '<workout_file><name>Empty</name></workout_file>';
    expect(() => parseZwoXml(xml)).toThrow(/missing <workout>/);
  });

  it('throws when a SteadyState segment is missing its Power attribute', () => {
    const xml = `<workout_file>
      <workout>
        <SteadyState Duration="60"/>
      </workout>
    </workout_file>`;
    expect(() => parseZwoXml(xml)).toThrow(/missing a required Power attribute/);
  });

  it('throws when a Ramp segment is missing PowerLow/PowerHigh', () => {
    const xml = `<workout_file>
      <workout>
        <Ramp Duration="60" PowerLow="0.5"/>
      </workout>
    </workout_file>`;
    expect(() => parseZwoXml(xml)).toThrow(/missing PowerLow\/PowerHigh/);
  });

  it('throws when an interval element is missing Duration', () => {
    const xml = `<workout_file>
      <workout>
        <FreeRide/>
      </workout>
    </workout_file>`;
    expect(() => parseZwoXml(xml)).toThrow(/missing a required Duration attribute/);
  });

  it('throws when no supported interval elements are present', () => {
    const xml = `<workout_file>
      <workout>
        <textnotification message="hi" timeoffset="0"/>
      </workout>
    </workout_file>`;
    expect(() => parseZwoXml(xml)).toThrow(/no supported interval elements/);
  });
});
