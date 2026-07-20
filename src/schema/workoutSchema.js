/**
 * 統一課表資料結構（Workout Schema）— Phase 1 技術規格 §2
 * 所有來源（zwo 檔、未來的 API）最終都要轉成這個格式，執行器只認這個 schema。
 */
export const INTERVAL_TYPES = ['warmup', 'steady', 'ramp', 'freeride', 'cooldown'];

export const intervalSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'duration', 'powerStart', 'powerEnd', 'cadence'],
  properties: {
    type: { type: 'string', enum: INTERVAL_TYPES },
    duration: { type: 'integer', minimum: 1 },
    powerStart: { type: ['integer', 'null'] },
    powerEnd: { type: ['integer', 'null'] },
    cadence: { type: ['integer', 'null'] },
  },
};

export const workoutSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Workout',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'source', 'totalDuration', 'intervals'],
  properties: {
    id: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    source: { type: 'string', enum: ['zwo'] },
    totalDuration: { type: 'integer', minimum: 0 },
    intervals: {
      type: 'array',
      minItems: 1,
      items: intervalSchema,
    },
  },
};
