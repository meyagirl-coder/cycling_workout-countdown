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
    // 「區間目標」（band）才有的選填欄位：整組期間維持在 powerRangeLow~
    // powerRangeHigh 這個瓦數區間內即可，不是固定單一值、也不是逐秒漸變到
    // 某個值（powerStart/powerEnd 仍然相等，固定在區間中點——只有這兩個欄位
    // 額外記住原始的區間範圍，讓時間軸柱狀圖可以畫出雙層堆疊的視覺效果，見
    // timelineSegments.js）。不是每個組別都有——只有 zwoParser.js 的
    // SteadyState PowerLow/PowerHigh、spacePercentTextParser.js 的
    // 「Y-Z%」範圍寫法才會設定，其他來源／組別完全不需要理會這兩個欄位，
    // 故意設計成選填（不在 required 裡）而不是「一律存在、預設 null」，
    // 這樣既有的 parser 完全不用改。
    powerRangeLow: { type: 'integer' },
    powerRangeHigh: { type: 'integer' },
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
    source: {
      type: 'string',
      enum: ['zwo', 'paste', 'whatsonzwift', 'paste-percent', 'paste-trainerday-full', 'paste-trainerday-structure'],
    },
    totalDuration: { type: 'integer', minimum: 0 },
    intervals: {
      type: 'array',
      minItems: 1,
      items: intervalSchema,
    },
  },
};
