import test from 'node:test';
import assert from 'node:assert/strict';
import { money } from '../miniprogram/services/format';

test('handoff monetary grouping preserves integer minor units and separate point units', () => {
  assert.equal(money(128050,'CNY'),'¥1,280.50');
  assert.equal(money(100000,'HKD'),'HK$1,000');
  assert.equal(money(9007199254740991,'MOP'),'MOP$90,071,992,547,409.91');
  assert.equal(money(-1,'CNY'),'¥-0.01');
  assert.equal(money(200000,'CNY','points'),'2,000 分');
});
