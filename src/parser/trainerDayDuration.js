/**
 * TrainerDay 時長欄位解析：
 * - `5 min` -> 300 秒
 * - `1.5 min` -> 90 秒
 * - `1:30 min` -> 90 秒（1 分 30 秒）
 * - `30 sec` -> 30 秒
 *
 * TrainerDay 的 `M:SS min` 是「分鐘:秒數」，不是小數分鐘。
 */
export const TRAINERDAY_DURATION_RE = /^(\d+(?::\d{2})?|\d+(?:\.\d+)?)\s*(min|sec)$/i;

export function parseTrainerDayDuration(amountText, unitText) {
  const unit = unitText.toLowerCase();
  if (amountText.includes(':')) {
    if (unit !== 'min') return null;

    const [minutesText, secondsText] = amountText.split(':');
    const minutes = Number(minutesText);
    const seconds = Number(secondsText);

    if (!Number.isInteger(minutes) || seconds < 0 || seconds >= 60) return null;
    return minutes * 60 + seconds;
  }

  const amount = Number(amountText);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(unit === 'min' ? amount * 60 : amount);
}
