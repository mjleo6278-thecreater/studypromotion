const test = require('node:test');
const assert = require('node:assert');
const { decide, errorText } = require('../js/cloud.js');

test('계정에 기록이 없으면 올린다', () => assert.strictEqual(decide({}, null, false), 'upload'));
test('이 기기가 비어 있으면 계정 기록을 받는다', () => assert.strictEqual(decide({}, { updatedAt: 1 }, true), 'download'));
test('처음 로그인했는데 양쪽에 기록이 있으면 묻는다', () => assert.strictEqual(decide({}, { updatedAt: 1 }, false), 'ask'));
test('다른 기기에서만 바뀌었으면 받는다', () => assert.strictEqual(decide({ remoteAt: 1 }, { updatedAt: 2 }, false), 'download'));
test('여기서만 바뀌었으면 올린다', () => assert.strictEqual(decide({ remoteAt: 1, dirty: true }, { updatedAt: 1 }, false), 'upload'));
test('양쪽 다 바뀌었으면 묻는다', () => assert.strictEqual(decide({ remoteAt: 1, dirty: true }, { updatedAt: 2 }, false), 'ask'));
test('그대로면 아무것도 안 한다', () => assert.strictEqual(decide({ remoteAt: 1 }, { updatedAt: 1 }, false), 'none'));
test('오류 메시지는 한국어로', () => {
  assert.match(errorText({ code: 'auth/email-already-in-use' }), /이미 가입된/);
  assert.match(errorText({ code: 'auth/invalid-credential' }), /맞지 않아요/);
});
