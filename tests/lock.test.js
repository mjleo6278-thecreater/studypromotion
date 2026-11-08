const test = require('node:test');
const assert = require('node:assert');
const { studiedMinutes } = require('../js/lock.js');
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
