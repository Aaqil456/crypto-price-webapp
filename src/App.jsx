import { useEffect, useState, useRef } from "react";

// Remove static symbols
// const symbols = ["BTCUSDT", "ETHUSDT"];
const intervalOptions = ["Min1", "Min5", "Min15", "Min30", "Hour1", "Hour4","Hour8","Day1","Week1","Month1"];

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
  const [symbols, setSymbols] = useState(["BTCUSDT", "ETHUSDT"]);
  // New: state for selected coins to display
  const [selectedSymbols, setSelectedSymbols] = useState(["BTCUSDT", "ETHUSDT"]);
  const [search, setSearch] = useState("");
  const [firstLoad, setFirstLoad] = useState(true);
  // Pagination state
  const PAGE_SIZE = 3;
  const [page, setPage] = useState(0);
  const pagedSymbols = selectedSymbols.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Fetch coin list every second
  useEffect(() => {
    let intervalId;
    const fetchSymbols = async () => {
      try {
        const res = await fetch("/api_mexc/api/v3/exchangeInfo");
        const data = await res.json();
        if (data.symbols) {
          const usdtSymbols = data.symbols
            .map((s) => s.symbol)
            .filter((s) => s.endsWith("USDT"));
          setSymbols(usdtSymbols);
          // Only set default on first load
          if (firstLoad) {
            setSelectedSymbols(usdtSymbols.slice(0, 10));
            setFirstLoad(false);
          }
        }
      } catch (err) {}
    };
    fetchSymbols();
    intervalId = setInterval(fetchSymbols, 1000);
    return () => clearInterval(intervalId);
  }, [firstLoad]);

  // Pre-fill closes for new coins
  useEffect(() => {
    const fetchKlines = async (symbol) => {
      try {
        // Get 100 klines for the current interval
        const res = await fetch(`/api_mexc/api/v3/klines?symbol=${symbol}&interval=1m&limit=100`);
        const data = await res.json();
        if (Array.isArray(data)) {
          const closesArr = data.map(k => parseFloat(k[4]));
          setCloses(prev => ({ ...prev, [symbol]: closesArr }));
        }
      } catch (err) {}
    };
    selectedSymbols.forEach(symbol => {
      if (!closes[symbol] || closes[symbol].length < 10) {
        fetchKlines(symbol);
      }
    });
  }, [selectedSymbols]);

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

  // ✅ WebSocket 1: Harga Semasa
  useEffect(() => {
    const wsPrice = new WebSocket("wss://wbs.mexc.com/ws");

    const subscribePrice = {
      method: "SUBSCRIPTION",
      params: selectedSymbols.map((symbol) => `spot@public.deals.v3.api@${symbol}`),
      id: "1",
    };

    wsPrice.onopen = () => {
      wsPrice.send(JSON.stringify(subscribePrice));
    };

    wsPrice.onmessage = (event) => {
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

    return () => wsPrice.close();
  }, [selectedSymbols]);

  // ✅ WebSocket 2: K-Line Semasa (bergantung kepada interval)
  useEffect(() => {
    const wsKline = new WebSocket("wss://wbs.mexc.com/ws");

    const subscribeKline = {
      method: "SUBSCRIPTION",
      params: selectedSymbols.map((symbol) => `spot@public.kline.v3.api@${symbol}@${interval}`),
      id: "2",
    };

    wsKline.onopen = () => {
      console.log("✅ K-line WebSocket connected");
      wsKline.send(JSON.stringify(subscribeKline));
    };

    wsKline.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data);
        const kline = raw?.d?.k;
        const symbol = raw?.s;
    
        if (kline && symbol) {
          const close = parseFloat(kline.c);
          // Update closes
          setCloses((prev) => {
            const prevArr = prev[symbol] ? [...prev[symbol]] : [];
            if (prevArr.length > 100) prevArr.shift(); // Keep max 100
            prevArr.push(close);
            // Calculate RSI and MACD with custom periods
            const rsi = calculateRSI(prevArr, rsiPeriod);
            const macd = calculateMACD(prevArr, macdFast, macdSlow, macdSignal);
            // Update indicators
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
    
    
    
    wsKline.onerror = (err) => console.error("WebSocket error:", err);
    wsKline.onclose = () => console.log("❌ K-line WebSocket closed");

    return () => wsKline.close();
  }, [interval, selectedSymbols, rsiPeriod, macdFast, macdSlow, macdSignal]);
  

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
            onChange={e => setSearch(e.target.value.toUpperCase())}
            className="form-control w-auto d-inline-block"
            style={{ width: 220 }}
          />
        </div>
        <div style={{ width: '100%' }}>
          <select
            multiple
            value={selectedSymbols}
            onChange={e => {
              const options = Array.from(e.target.selectedOptions).map(opt => opt.value);
              setSelectedSymbols(options);
              setPage(0); // Reset to first page on selection change
            }}
            className="form-select w-auto"
            size={6}
            style={{ minWidth: 180, width: 220 }}
          >
            {symbols
              .filter(s => s.includes(search))
              .map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
          </select>
        </div>
        <div>
          <button
            className="btn btn-secondary ms-2"
            onClick={() => { setSelectedSymbols(symbols.slice(0, PAGE_SIZE)); setPage(0); }}
          >
            Reset to Top {PAGE_SIZE}
          </button>
        </div>
      </div>

      {/* Pagination controls */}
      <div className="mb-3 d-flex gap-2 align-items-center">
        <button
          className="btn btn-outline-light btn-sm"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
        >Prev</button>
        <span className="text-white">Page {page + 1} of {Math.ceil(selectedSymbols.length / PAGE_SIZE) || 1}</span>
        <button
          className="btn btn-outline-light btn-sm"
          onClick={() => setPage((p) => Math.min(Math.ceil(selectedSymbols.length / PAGE_SIZE) - 1, p + 1))}
          disabled={page >= Math.ceil(selectedSymbols.length / PAGE_SIZE) - 1}
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
                {pagedSymbols.map((symbol) => {
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
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
