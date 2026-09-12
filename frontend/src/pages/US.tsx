import USMarket from '../components/USMarket';

export default function US() {
  return (
    <div>
      <div className="stock-header">
        <div className="stock-title">
          <div className="sym">USA</div>
          <div className="nm">US Market · live via TradingView screener</div>
        </div>
      </div>
      <USMarket />
    </div>
  );
}
