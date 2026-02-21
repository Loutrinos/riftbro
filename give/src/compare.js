/**
 * Compare a trade list against a wishlist.
 * Returns cards from `tradeMap` that appear in `wishlistMap`.
 *
 * @param {Map} tradeMap    - cards the trader has to offer
 * @param {Map} wishlistMap - cards the wishlist holder wants
 * @returns {Array<{cardId, imageUrl, cardUrl, tradeQty, wantedQty, canGive}>}
 */
export function compare(tradeMap, wishlistMap) {
  const matches = [];

  for (const [cardId, wantedCard] of wishlistMap) {
    if (!tradeMap.has(cardId)) continue;

    const tradeCard = tradeMap.get(cardId);
    matches.push({
      cardId,
      imageUrl: tradeCard.imageUrl,
      cardUrl: tradeCard.cardUrl,
      tradeQty: tradeCard.quantity,
      wantedQty: wantedCard.quantity,
      canGive: Math.min(tradeCard.quantity, wantedCard.quantity),
    });
  }

  // Sort by set code then card number (e.g. OGN-001 < OGN-002 < SFD-005)
  matches.sort((a, b) => {
    const [aSet, aNum] = a.cardId.split('-');
    const [bSet, bNum] = b.cardId.split('-');
    if (aSet !== bSet) return aSet.localeCompare(bSet);
    return parseInt(aNum, 10) - parseInt(bNum, 10);
  });

  return matches;
}
