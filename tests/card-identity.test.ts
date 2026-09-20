import test from 'node:test';
import assert from 'node:assert/strict';
import type { Card } from '../shared/contracts';
import { cardLabel, cardLabels, cardNeedsNickname, cardReference } from '../miniprogram/services/card-labels';

function card(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id, ownerId: 'owner', bankId: 'cmb', issuerId: 'cmb-cn', network: 'visa', kind: 'credit',
    nickname: 'Daily card', createdAt: '2026-01-01T00:00:00Z', ...overrides,
  };
}

test('compact labels use unique nicknames and meaningful descriptions before adding friendly ordinals', () => {
  const unique = [card('first'), card('second', { nickname: 'Travel card' })];
  assert.deepEqual(cardLabels(unique), { first: 'Daily card', second: 'Travel card' });
  const different = [card('first'), card('second', { network: 'mastercard' })];
  assert.match(cardLabel('first', different), /Daily card.*Visa/);
  assert.match(cardLabel('second', different), /Daily card.*Mastercard/);
  assert.equal(cardNeedsNickname('first', different), false);
  assert.equal(cardNeedsNickname('second', different), false);
  assert(Object.values(cardLabels(different)).every(label => !label.includes('标识') && !label.includes('同名卡')));
});

test('legacy ambiguous labels stay distinct across array ordering and never reveal system references', () => {
  const cards = [
    card('later-card', { createdAt: '2026-02-01T00:00:00Z' }),
    card('earlier-card', { createdAt: '2026-01-01T00:00:00Z' }),
  ];
  const labels = cardLabels(cards);
  assert.match(labels['earlier-card'], /同名卡1$/);
  assert.match(labels['later-card'], /同名卡2$/);
  assert.notEqual(labels['earlier-card'], labels['later-card']);
  assert.deepEqual(cardLabels([...cards].reverse()), labels);
  const extended = [...cards, card('new-card', { createdAt: '2026-03-01T00:00:00Z' })];
  assert.equal(cardLabel('earlier-card', extended), labels['earlier-card']);
  assert.equal(cardLabel('later-card', extended), labels['later-card']);
  for (const value of cards) {
    assert.equal(cardNeedsNickname(value.id, cards), true);
    assert(!labels[value.id].includes('标识'));
    assert(!labels[value.id].includes(cardReference(value.id, cards)));
    assert(!labels[value.id].includes(value.id));
  }
});

test('unnamed identical cards receive friendly guidance while unique descriptions do not require a nickname', () => {
  const unnamed = [card('first', { nickname: '' }), card('second', { nickname: '' })];
  assert.notEqual(cardLabel('first', unnamed), cardLabel('second', unnamed));
  assert.equal(cardNeedsNickname('first', unnamed), true);
  const distinct = [unnamed[0], card('second', { nickname: '', kind: 'debit' })];
  assert.equal(cardNeedsNickname('first', distinct), false);
  assert.equal(cardNeedsNickname('second', distinct), false);
});

test('archived and foreign-owner cards do not force renaming an active card', () => {
  const cards = [
    card('active'),
    card('archived', { archivedAt: '2026-02-01T00:00:00Z' }),
    card('foreign', { ownerId: 'other-owner' }),
  ];
  assert.equal(cardLabel('active', cards), 'Daily card');
  assert.equal(cardNeedsNickname('active', cards), false);
  assert.equal(cardNeedsNickname('archived', cards), false);
  assert.match(cardLabel('archived', cards), /已移除/);
  assert.equal(cardNeedsNickname('missing', cards), false);
});

test('archived duplicate records retain friendly distinct identities without hashes', () => {
  const cards = [card('old-a', { archivedAt: '2026-03-01' }), card('old-b', { archivedAt: '2026-03-01' })];
  assert.notEqual(cardLabel('old-a', cards), cardLabel('old-b', cards));
  assert.deepEqual(cardLabels([...cards].reverse()), cardLabels(cards));
  assert(Object.values(cardLabels(cards)).every(label => label.includes('已移除') && !label.includes('标识')));
});

test('detailed labels preserve diagnostic references while missing compact metadata stays explicit', () => {
  const cards = [card('first'), card('second')];
  assert(cardLabel('first', cards, 'detailed').includes(cardReference('first', cards)));
  assert.match(cardLabel('first', cards, 'detailed'), /系统标识/);
  assert.match(cardLabel('missing-a', []), /资料缺失/);
  assert(!cardLabel('missing-a', []).includes('标识'));
  assert.notEqual(cardLabel('missing-a', [], 'detailed'), cardLabel('missing-b', [], 'detailed'));
  assert.equal(cardLabel(undefined, cards), '');
});
