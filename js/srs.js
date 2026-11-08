/* SM-2 간격 반복 알고리즘 (순수 함수) */
(function (root) {
  const DAY = 24 * 60 * 60 * 1000;

  // 평가 버튼 → SM-2 품질 점수(0~5)
  const GRADES = { again: 1, hard: 3, good: 4, easy: 5 };

  function newCard(fields, now) {
    return Object.assign(
      { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: startOfDay(now) },
      fields
    );
  }

  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /**
   * 카드를 평가하고 새 카드 객체를 돌려준다.
   * @param {object} card  ease, interval, reps, lapses
   * @param {'again'|'hard'|'good'|'easy'} grade
   * @param {number} now  ms timestamp
   */
  function review(card, grade, now) {
    const q = GRADES[grade];
    if (q === undefined) throw new Error('알 수 없는 평가: ' + grade);
    let { ease, interval, reps, lapses = 0 } = card;

    if (q < 3) {
      // 틀림: 처음부터 다시, 오늘 다시 보기
      reps = 0;
      interval = 0;
      lapses += 1;
    } else {
      reps += 1;
      if (reps === 1) interval = 1;
      else if (reps === 2) interval = q === 5 ? 4 : 3;
      else interval = Math.round(interval * ease);
      if (grade === 'hard') interval = Math.max(1, Math.round(interval * 0.8));
      if (grade === 'easy' && reps > 2) interval = Math.round(interval * 1.3);
    }

    ease = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    ease = Math.max(1.3, Math.round(ease * 100) / 100);

    const due = interval === 0 ? now : startOfDay(now) + interval * DAY;
    return Object.assign({}, card, { ease, interval, reps, lapses, due, lastReviewed: now });
  }

  function isDue(card, now) {
    return card.due <= now;
  }

  // 버튼 아래 표시할 예상 간격 텍스트
  function previewLabel(card, grade, now) {
    const next = review(card, grade, now);
    if (next.interval === 0) return '오늘';
    if (next.interval < 30) return next.interval + '일';
    if (next.interval < 365) return Math.round(next.interval / 30) + '개월';
    return (next.interval / 365).toFixed(1) + '년';
  }

  const api = { review, isDue, newCard, previewLabel, startOfDay, GRADES, DAY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SRS = api;
})(typeof window !== 'undefined' ? window : globalThis);
