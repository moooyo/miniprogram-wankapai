import type { Card } from '../../shared/contracts';
import { banks } from '../../shared/catalog';

const networkNames: Record<Card['network'], string> = {
  visa: 'Visa', mastercard: 'Mastercard', unionpay: '银联', amex: 'American Express', other: '其他卡组织',
};

function reference(cardId: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < cardId.length; index += 1) hash = Math.imul(hash ^ cardId.charCodeAt(index), 0x01000193) >>> 0;
  return hash.toString(36).toUpperCase().padStart(7, '0');
}

export function cardReference(cardId: string, cards: readonly Card[] = []): string {
  const code = reference(cardId);
  const collisions = Array.from(new Set([...cards.map(card => card.id), cardId])).filter(id => reference(id) === code).sort();
  return collisions.length > 1 ? `${code}-${collisions.indexOf(cardId) + 1}` : code;
}

function cardDescription(card: Card): string {
  const bank = banks.find(item => item.id === card.bankId)?.shortName || '银行卡';
  return `${bank} ${networkNames[card.network]} ${card.kind === 'credit' ? '信用卡' : '借记卡'}`;
}

function primaryName(card: Card): string {
  return card.nickname.trim() || cardDescription(card);
}

function peers(card: Card, cards: readonly Card[]): Card[] {
  return cards.filter(item => item.ownerId === card.ownerId && !!item.archivedAt === !!card.archivedAt);
}

function descriptiveName(card: Card, cards: readonly Card[]): string {
  const name = primaryName(card);
  const repeated = peers(card, cards).some(item => item.id !== card.id && primaryName(item) === name);
  return repeated && card.nickname.trim() ? `${name} · ${cardDescription(card)}` : name;
}

function ambiguityGroup(card: Card, cards: readonly Card[]): Card[] {
  const name = descriptiveName(card, cards);
  return peers(card, cards).filter(item => descriptiveName(item, cards) === name).sort((left, right) => {
    const a = left.createdAt + ':' + left.id, b = right.createdAt + ':' + right.id;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

export function cardNeedsNickname(cardId: string | undefined, cards: readonly Card[]): boolean {
  const card = cards.find(item => item.id === cardId);
  return !!card && !card.archivedAt && ambiguityGroup(card, cards).length > 1;
}

export function cardLabel(cardId: string | undefined, cards: readonly Card[], mode: 'compact' | 'detailed' = 'compact'): string {
  if (!cardId) return '';
  const card = cards.find(item => item.id === cardId);
  let label = '已移除的卡片（资料缺失）';
  if (card) {
    const group = ambiguityGroup(card, cards);
    const suffix = group.length > 1 ? ` · 同名卡${group.findIndex(item => item.id === card.id) + 1}` : '';
    label = descriptiveName(card, cards) + suffix + (card.archivedAt ? '（已移除）' : '');
  }
  return mode === 'detailed' ? `${label} · 系统标识 ${cardReference(cardId, cards)}` : label;
}

export function cardLabels(cards: readonly Card[], mode: 'compact' | 'detailed' = 'compact'): Record<string, string> {
  return Object.fromEntries(cards.map(card => [card.id, cardLabel(card.id, cards, mode)]));
}
