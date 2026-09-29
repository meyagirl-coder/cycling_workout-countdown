/**
 * TrainerDay「Workout structure」區塊解析器。
 * 支援 X min / X sec，以及 TrainerDay 的 M:SS min，例如 1:30 min = 90 秒。
 */
import { generateId } from '../utils/generateId.js';
import { BRACKET_REPEAT_LINE_RE, parseNewlineRepeatText, REPEAT_LINE_RE } from './newlineRepeatTextParser.js';
import { parseTrainerDayDuration } from './trainerDayDuration.js';

const STATUS_LABEL_ALTERNATION = 'warm-?up|active|cooldown|interval|rest|free-?ride|open-ended';

export const TRAINERDAY_STRUCTURE_LINE_RE = new RegExp(
  `^(?:(?:${STATUS_LABEL_ALTERNATION})\\s+)*(\\d+(?::\\d{2})?|\\d+(?:\\.\\d+)?)\\s*(min|sec)\\s*@\\s*(\\d+(?:\\.\\d+)?)%\\s*\\(\\s*\\d+(?:\\.\\d+)?\\s*w\\s*\\)(?:\\s+(\\d+(?:\\.\\d+)?)\\s*rpm)?$`,
  'i'
);

export { REPEAT_LINE_RE, BRACKET_REPEAT_LINE_RE };

const CORE_INTERVAL_RE =
  /(\d+(?::\d{2})?|\d+(?:\.\d+)?)\s*(min|sec)\s*@\s*(\d+(?:\.\d+)?)\s*%\s*\(\s*\d+(?:\.\d+)?\s*w\s*\)/i;
const CADENCE_RE = /(\d+(?:\.\d+)?)\s*rpm/i;

export function parseTrainerDayWorkoutStructureText(text) {
  const intervals = parseNewlineRepeatText(text, parseIntervalLine, '"X min @ Y% (Zw)"');
  const totalDuration = intervals.reduce((sum, iv) => sum + iv.duration, 0);

  return {
    id: generateId(),
    name: 'Untitled Workout',
    source: 'paste-trainerday-structure',
    totalDuration,
    intervals,
  };
}

function parseIntervalLine(line) {
  const match = line.match(CORE_INTERVAL_RE);
  if (!match) return null;

  const duration = parseTrainerDayDuration(match[1], match[2]);
  if (duration == null) return null;

  const powerPct = Math.round(Number(match[3]));
  const cadenceMatch = line.match(CADENCE_RE);
  const cadence = cadenceMatch ? Math.round(Number(cadenceMatch[1])) : null;

  return {
    type: 'steady',
    duration,
    powerStart: powerPct,
    powerEnd: powerPct,
    cadence,
  };
}
