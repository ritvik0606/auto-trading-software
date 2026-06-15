import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../services/api";

function normalizeSymbol(symbol) {
  return typeof symbol === "string"
    ? symbol.trim().toUpperCase().replace(/-EQ$/, "")
    : "";
}

function addQuote(current, quote) {
  if (!quote?.symbol || quote.ltp == null) {
    return current;
  }

  const next = { ...current };
  [quote.symbol, quote.tradingSymbol, quote.symbolToken]
    .map(normalizeSymbol)
    .filter(Boolean)
    .forEach((key) => {
      next[key] = quote;
    });
  return next;
}

export default function useMarketStream(symbols = []) {
  const safeSymbols = Array.isArray(symbols) ? symbols : [];
  const rawSymbolKey = safeSymbols.join(",");
  const symbolKey = useMemo(
    () =>
      Array.from(new Set(safeSymbols.map(normalizeSymbol).filter(Boolean)))
        .sort()
        .join(","),
    [rawSymbolKey]
  );
  const [quotes, setQuotes] = useState({});
  const [status, setStatus] = useState({
    state: "CONNECTING",
    connected: false,
    mode: "PAPER_ONLY",
  });
  const [streamError, setStreamError] = useState("");

  useEffect(() => {
    const baseUrl = API_BASE_URL.replace(/\/$/, "");
    const query = symbolKey
      ? `?symbols=${encodeURIComponent(symbolKey)}`
      : "";
    const source = new EventSource(
      `${baseUrl}/api/market/stream${query}`
    );

    const handleTick = (event) => {
      try {
        const quote = JSON.parse(event?.data || "{}");
        setQuotes((current) => addQuote(current || {}, quote || {}));
        setStreamError("");
      } catch {
        setStreamError("Live market tick could not be read.");
      }
    };
    const handleSnapshot = (event) => {
      try {
        const snapshot = JSON.parse(event?.data || "[]");
        const safeSnapshot = Array.isArray(snapshot) ? snapshot : [];
        setQuotes((current) =>
          safeSnapshot.reduce(addQuote, current || {})
        );
      } catch {
        setStreamError("Live market snapshot could not be read.");
      }
    };
    const handleStatus = (event) => {
      try {
        const nextStatus = JSON.parse(event?.data || "{}");
        setStatus(
          nextStatus && typeof nextStatus === "object"
            ? nextStatus
            : {}
        );
      } catch {
        setStatus({ state: "DISCONNECTED", connected: false });
      }
    };

    source.addEventListener("tick", handleTick);
    source.addEventListener("snapshot", handleSnapshot);
    source.addEventListener("status", handleStatus);
    source.onerror = () => {
      setStreamError(
        "Live feed reconnecting. Paper trading mode remains active."
      );
    };

    return () => source.close();
  }, [symbolKey]);

  const getQuote = (symbol) =>
    (quotes || {})[normalizeSymbol(symbol)] || null;

  return {
    quotes,
    getQuote,
    status,
    streamError,
    connected: Boolean(status?.connected),
    lastTickAt: status?.lastTickAt || null,
  };
}
