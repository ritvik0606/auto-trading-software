export function applyLivePrice(item, quote, fields = {}) {
  const averagePrice = Number(
    item[fields.averagePrice || "averagePrice"] || 0
  );
  const quantity = Number(item[fields.quantity || "quantity"] || 0);
  const side = item[fields.side || "side"] || "BUY";
  const fallbackPrice = Number(
    item[fields.currentPrice || "currentPrice"] || averagePrice
  );
  const currentPrice = Number(quote?.ltp ?? fallbackPrice);
  const direction = side === "SELL" ? -1 : 1;
  const investedValue = averagePrice * quantity;
  const currentValue = currentPrice * quantity;
  const unrealizedPnL =
    (currentPrice - averagePrice) * quantity * direction;

  return {
    ...item,
    currentPrice,
    investedValue,
    currentValue,
    unrealizedPnL,
    unrealizedPnl: unrealizedPnL,
    totalPositionValue: currentValue,
    pnlPercent:
      investedValue === 0 ? 0 : (unrealizedPnL / investedValue) * 100,
    priceSource: quote?.source || item.priceSource || null,
  };
}

export function sumBy(rows, key) {
  return rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
}
