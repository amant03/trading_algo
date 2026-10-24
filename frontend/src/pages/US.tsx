import USMarket from '../components/USMarket';

export default function US() {
  return (
    <div>
      <div className="stock-header">
        <div className="stock-title">
          <h1 className="sym">USA</h1>
          <div className="nm">US Market · live via TradingView screener</div>
        </div>
      </div>
      <USMarket />
    </div>
  );
}
