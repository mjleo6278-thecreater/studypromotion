const test = require('node:test');
const assert = require('node:assert');
const { studiedMinutes, tailMinutes } = require('../js/lock.js');
const M = 60000;
test('끝까지 잠그면 정한 시간 전부 기록', () => {
  assert.strictEqual(studiedMinutes({ startAt: 0, endAt: 60 * M, awayMs: 0 }, 70 * M), 60);
});
test('다른 앱에 나가 있던 시간은 뺀다', () => {
  assert.strictEqual(studiedMinutes({ startAt: 0, endAt: 60 * M, awayMs: 10 * M }, 60 * M), 50);
});
test('중간에 그만두면 그때까지만', () => {
  assert.strictEqual(studiedMinutes({ startAt: 0, endAt: 60 * M, awayMs: 0 }, 25.5 * M), 25);
});
// 스톱워치를 켜 둔 채 잠갔는데 스톱워치가 먼저 멈췄을 때: 스톱워치가 기록한 뒤만 잠금으로 (v4.5.1)
test('스톱워치가 멈춘 뒤의 잠금 시간만 센다', () => {
  assert.strictEqual(tailMinutes({ startAt: 0, endAt: 60 * M, awayMs: 0 }, 60 * M, 20 * M), 40);
});
test('나가 있던 시간은 남은 구간 길이만큼 나눠서 뺀다', () => {
  assert.strictEqual(tailMinutes({ startAt: 0, endAt: 60 * M, awayMs: 12 * M }, 60 * M, 30 * M), 24);
});
test('스톱워치가 끝까지 쟀거나 기록이 잠금 전이면', () => {
  assert.strictEqual(tailMinutes({ startAt: 0, endAt: 60 * M, awayMs: 0 }, 60 * M, 60 * M), 0);
  assert.strictEqual(tailMinutes({ startAt: 10 * M, endAt: 70 * M, awayMs: 0 }, 70 * M, 0), 60);
});
