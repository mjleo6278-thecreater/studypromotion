const test = require('node:test');
const assert = require('node:assert');
const { decide } = require('../js/gsync.js');

test('드라이브에 파일이 없으면 올린다', () => {
  assert.strictEqual(decide({}, null), 'upload');
});
test('이 기기에서 처음 연결했는데 드라이브에 기록이 있으면 묻는다', () => {
  assert.strictEqual(decide({}, { modifiedTime: 't1' }), 'ask');
});
test('다른 기기에서 바뀌었고 여기는 그대로면 내려받는다', () => {
  assert.strictEqual(decide({ remoteModified: 't1', dirty: false }, { modifiedTime: 't2' }), 'download');
});
test('여기만 바뀌었으면 올린다', () => {
  assert.strictEqual(decide({ remoteModified: 't1', dirty: true }, { modifiedTime: 't1' }), 'upload');
});
test('양쪽 다 바뀌었으면 묻는다', () => {
  assert.strictEqual(decide({ remoteModified: 't1', dirty: true }, { modifiedTime: 't2' }), 'ask');
});
test('둘 다 그대로면 아무것도 안 한다', () => {
  assert.strictEqual(decide({ remoteModified: 't1', dirty: false }, { modifiedTime: 't1' }), 'none');
});
