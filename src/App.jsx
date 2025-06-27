import { useEffect, useState, useRef } from "react";
import coinSymbolsRaw from './List_of_Coin_Symbols.csv?raw';

// Remove static symbols
// const symbols = ["BTCUSDT", "ETHUSDT"];
const intervalOptions = ["Min1", "Min5", "Min15", "Min30", "Hour1", "Hour4","Hour8","Day1","Week1","Month1"];


// Parse CSV for coin symbols
const parseCoinSymbols = () => {
  // Split by lines, skip header, trim whitespace
  return coinSymbolsRaw.split('\n').slice(1).map(line => line.trim()).filter(Boolean);
};

// Debounce hook
function useDebouncedEffect(effect, deps, delay) {
  const callback = useRef();
  useEffect(() => { callback.current = effect; }, [effect]);
  useEffect(() => {
    const handler = setTimeout(() => callback.current(), delay);
    return () => clearTimeout(handler);
  }, [...deps, delay]);
}

const App = () => {
  const [prices, setPrices] = useState({});
  const [indicators, setIndicators] = useState({});
  const [interval, setIntervalValue] = useState("Min15"); // Default
  // Store historical closes for each symbol
  const [closes, setCloses] = useState({});
  // Customizable periods
  const [rsiPeriod, setRsiPeriod] = useState(14);
  const [macdFast, setMacdFast] = useState(12);
  const [macdSlow, setMacdSlow] = useState(26);
  const [macdSignal, setMacdSignal] = useState(9);
  // Dynamic coin list
  const [symbols, setSymbols] = useState(parseCoinSymbols());
  // Remove search from select logic, use it to filter symbols directly
  const [search, setSearch] = useState("");
  // Pagination state
  const PAGE_SIZE = 3;
  const [page, setPage] = useState(0);
  // Filter symbols by search
  const filteredSymbols = symbols.filter(s => s.includes(search));
  const pagedSymbols = filteredSymbols.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // --- RSI Calculation ---
  function calculateRSI(closes, period = 14) {
    if (closes.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    if (gains + losses === 0) return 50;
    const rs = gains / (losses === 0 ? 1 : losses);
    return 100 - 100 / (1 + rs);
  }

  // --- MACD Calculation ---
  function calculateEMA(values, period) {
    const k = 2 / (period + 1);
    let ema = values[0];
    for (let i = 1; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
    }
    return ema;
  }
  function calculateMACD(closes, fast = 12, slow = 26, signal = 9) {
    if (closes.length < slow + signal) return { macd: null, signal: null, hist: null };
    const fastEMA = calculateEMA(closes.slice(-fast - signal), fast);
    const slowEMA = calculateEMA(closes.slice(-slow - signal), slow);
    const macdLine = fastEMA - slowEMA;
    // Signal line is EMA of MACD line
    let macdArr = [];
    for (let i = closes.length - slow - signal + 1; i <= closes.length - slow; i++) {
      const fastE = calculateEMA(closes.slice(i, i + fast), fast);
      const slowE = calculateEMA(closes.slice(i, i + slow), slow);
      macdArr.push(fastE - slowE);
    }
    const signalLine = calculateEMA(macdArr, signal);
    const hist = macdLine - signalLine;
    return { macd: macdLine, signal: signalLine, hist };
  }

  // --- Persistent WebSocket for Price ---
  const wsPriceRef = useRef(null);
  const prevPriceSymbolsRef = useRef([]);
  useDebouncedEffect(() => {
    if (!pagedSymbols || pagedSymbols.length === 0) return;
    if (!wsPriceRef.current) {
      wsPriceRef.current = new WebSocket("wss://wbs.mexc.com/ws");
      wsPriceRef.current.onopen = () => {
        wsPriceRef.current.send(JSON.stringify({
          method: "SUBSCRIPTION",
          params: pagedSymbols.map((symbol) => `spot@public.deals.v3.api@${symbol}`),
          id: "1",
        }));
        prevPriceSymbolsRef.current = [...pagedSymbols];
      };
      wsPriceRef.current.onmessage = (event) => {
        const raw = JSON.parse(event.data);
        const topic = raw?.c;
        const symbol = topic?.split("@").pop();
        const price = raw?.d?.deals?.[0]?.p;
        if (symbol && price) {
          setPrices((prev) => ({
            ...prev,
            [symbol]: parseFloat(price).toFixed(2),
          }));
        }
      };
      wsPriceRef.current.onerror = (err) => console.error("WebSocket error:", err);
      wsPriceRef.current.onclose = () => console.log("❌ Price WebSocket closed");
    } else {
      // Unsubscribe previous
      if (prevPriceSymbolsRef.current.length > 0) {
        wsPriceRef.current.send(JSON.stringify({
          method: "UNSUBSCRIPTION",
          params: prevPriceSymbolsRef.current.map((symbol) => `spot@public.deals.v3.api@${symbol}`),
          id: "1u",
        }));
      }
      // Subscribe new
      wsPriceRef.current.send(JSON.stringify({
        method: "SUBSCRIPTION",
        params: pagedSymbols.map((symbol) => `spot@public.deals.v3.api@${symbol}`),
        id: "1",
      }));
      prevPriceSymbolsRef.current = [...pagedSymbols];
    }
    return () => {
      if (wsPriceRef.current) {
        wsPriceRef.current.close();
        wsPriceRef.current = null;
        prevPriceSymbolsRef.current = [];
      }
    };
  }, [pagedSymbols], 500);

  // --- Persistent WebSocket for K-line ---
  const wsKlineRef = useRef(null);
  const prevKlineSymbolsRef = useRef([]);
  const prevIntervalRef = useRef(interval);
  useDebouncedEffect(() => {
    if (!pagedSymbols || pagedSymbols.length === 0) return;
    if (!wsKlineRef.current) {
      wsKlineRef.current = new WebSocket("wss://wbs.mexc.com/ws");
      wsKlineRef.current.onopen = () => {
        console.log("✅ K-line WebSocket connected");
        wsKlineRef.current.send(JSON.stringify({
          method: "SUBSCRIPTION",
          params: pagedSymbols.map((symbol) => `spot@public.kline.v3.api@${symbol}@${interval}`),
          id: "2",
        }));
        prevKlineSymbolsRef.current = [...pagedSymbols];
        prevIntervalRef.current = interval;
      };
      wsKlineRef.current.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data);
          const kline = raw?.d?.k;
          const symbol = raw?.s;
          if (kline && symbol) {
            const close = parseFloat(kline.c);
            setCloses((prev) => {
              const prevArr = prev[symbol] ? [...prev[symbol]] : [];
              if (prevArr.length > 100) prevArr.shift();
              prevArr.push(close);
              const rsi = calculateRSI(prevArr, rsiPeriod);
              const macd = calculateMACD(prevArr, macdFast, macdSlow, macdSignal);
              setIndicators((prevInd) => ({
                ...prevInd,
                [symbol]: {
                  ...prevInd[symbol],
                  open: parseFloat(kline.o),
                  close,
                  high: parseFloat(kline.h),
                  low: parseFloat(kline.l),
                  volume: parseFloat(kline.v),
                  amount: parseFloat(kline.a),
                  interval: kline.i,
                  start: kline.t,
                  end: kline.T,
                  rsi,
                  macd: macd.macd,
                  macdSignal: macd.signal,
                  macdHist: macd.hist,
                },
              }));
              return { ...prev, [symbol]: prevArr };
            });
          }
        } catch (err) {
          console.error("❌ Failed to parse WebSocket message:", err);
        }
      };
      wsKlineRef.current.onerror = (err) => console.error("WebSocket error:", err);
      wsKlineRef.current.onclose = () => console.log("❌ K-line WebSocket closed");
    } else {
      // Unsubscribe previous
      if (prevKlineSymbolsRef.current.length > 0) {
        wsKlineRef.current.send(JSON.stringify({
          method: "UNSUBSCRIPTION",
          params: prevKlineSymbolsRef.current.map((symbol) => `spot@public.kline.v3.api@${symbol}@${prevIntervalRef.current}`),
          id: "2u",
        }));
      }
      // Subscribe new
      wsKlineRef.current.send(JSON.stringify({
        method: "SUBSCRIPTION",
        params: pagedSymbols.map((symbol) => `spot@public.kline.v3.api@${symbol}@${interval}`),
        id: "2",
      }));
      prevKlineSymbolsRef.current = [...pagedSymbols];
      prevIntervalRef.current = interval;
    }
    return () => {
      if (wsKlineRef.current) {
        wsKlineRef.current.close();
        wsKlineRef.current = null;
        prevKlineSymbolsRef.current = [];
      }
    };
  }, [pagedSymbols, interval], 500);
  

  return (
    <div className="container-fluid py-4 px-4">
      <h2 className="text-white mb-4">📊 Harga Crypto Live (MEXC)</h2>

      {/* Search and select coins */}
      <div className="mb-3 d-flex flex-column gap-2 align-items-start">
        <div style={{ width: '100%' }}>
          <input
            type="text"
            placeholder="Search coin (e.g. BTCUSDT)"
            value={search}
            onChange={e => { setSearch(e.target.value.toUpperCase()); setPage(0); }}
            className="form-control w-auto d-inline-block"
            style={{ width: 220 }}
          />
        </div>
      </div>

      {/* Pagination controls */}
      <div className="mb-3 d-flex gap-2 align-items-center">
        <button
          className="btn btn-outline-light btn-sm"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
        >Prev</button>
        <span className="text-white">Page {page + 1} of {Math.ceil(filteredSymbols.length / PAGE_SIZE) || 1}</span>
        <button
          className="btn btn-outline-light btn-sm"
          onClick={() => setPage((p) => Math.min(Math.ceil(filteredSymbols.length / PAGE_SIZE) - 1, p + 1))}
          disabled={page >= Math.ceil(filteredSymbols.length / PAGE_SIZE) - 1}
        >Next</button>
      </div>

      {/* ✅ Dropdown tukar interval */}
      <div className="mb-3">
        <label className="text-white me-2">Interval:</label>
        <select
          value={interval}
          onChange={(e) => setIntervalValue(e.target.value)}
          className="form-select w-auto d-inline-block"
        >
          {intervalOptions.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
      {/* RSI & MACD Period Controls */}
      <div className="mb-3 d-flex flex-wrap gap-3 align-items-center">
        <div>
          <label className="text-white me-2">RSI Period:</label>
          <input
            type="number"
            min="2"
            max="50"
            value={rsiPeriod}
            onChange={e => setRsiPeriod(Number(e.target.value))}
            className="form-control w-auto d-inline-block"
          />
        </div>
        <div>
          <label className="text-white me-2">MACD Fast:</label>
          <input
            type="number"
            min="2"
            max="50"
            value={macdFast}
            onChange={e => setMacdFast(Number(e.target.value))}
            className="form-control w-auto d-inline-block"
          />
        </div>
        <div>
          <label className="text-white me-2">MACD Slow:</label>
          <input
            type="number"
            min="2"
            max="100"
            value={macdSlow}
            onChange={e => setMacdSlow(Number(e.target.value))}
            className="form-control w-auto d-inline-block"
          />
        </div>
        <div>
          <label className="text-white me-2">MACD Signal:</label>
          <input
            type="number"
            min="2"
            max="50"
            value={macdSignal}
            onChange={e => setMacdSignal(Number(e.target.value))}
            className="form-control w-auto d-inline-block"
          />
        </div>
      </div>

      {/* ✅ Table display */}
      <div className="row">
        <div className="col-12 col-lg-10 col-xl-9">
          <div className="table-responsive">
            <table className="table table-dark table-bordered table-striped align-middle mb-0">
              <thead className="table-dark">
                <tr>
                  <th className="px-4">Coin</th>
                  <th className="px-4">Harga (USDT)</th>
                  <th className="px-4">Open</th>
                  <th className="px-4">High</th>
                  <th className="px-4">Low</th>
                  <th className="px-4">Close</th>
                  <th className="px-4">Volume ({interval})</th>
                  <th className="px-4">RSI</th>
                  <th className="px-4">MACD</th>
                  <th className="px-4">MACD Signal</th>
                  <th className="px-4">MACD Hist</th>
                </tr>
              </thead>
              <tbody>
                {pagedSymbols.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="text-center">No coins found.</td>
                  </tr>
                ) : (
                  pagedSymbols.map((symbol) => {
                    return (
                      <tr key={symbol}>
                        <td className="px-4">{symbol}</td>
                        <td className="px-4">{prices[symbol] || "-"}</td>
                        <td className="px-4">{indicators[symbol]?.open?.toFixed(2) || "-"}</td>
                        <td className="px-4">{indicators[symbol]?.high?.toFixed(2) || "-"}</td>
                        <td className="px-4">{indicators[symbol]?.low?.toFixed(2) || "-"}</td>
                        <td className="px-4">{indicators[symbol]?.close?.toFixed(2) || "-"}</td>
                        <td className="px-4">{indicators[symbol]?.volume?.toFixed(2) || "-"}</td>
                        <td className="px-4">{indicators[symbol]?.rsi ? indicators[symbol].rsi.toFixed(2) : "-"}</td>
                        <td className="px-4">{indicators[symbol]?.macd ? indicators[symbol].macd.toFixed(2) : "-"}</td>
                        <td className="px-4">{indicators[symbol]?.macdSignal ? indicators[symbol].macdSignal.toFixed(2) : "-"}</td>
                        <td className="px-4">{indicators[symbol]?.macdHist ? indicators[symbol].macdHist.toFixed(2) : "-"}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
