import type { Module } from '../types';
import { example, h, note, p, ul } from '../blocks';

export const market: Module = {
  slug: 'market',
  title: 'The stock market',
  blurb: 'How a price gets printed, who stands between you and the exchange, and what a session on the NSE actually is.',
  level: 'Beginner',
  chapters: [
    {
      slug: 'why-prices-move',
      title: 'Why a price exists',
      minutes: 6,
      blocks: [
        p('A price is the last point where a buyer and a seller agreed. It is not the exchange announcing what a company is worth, and it is not a forecast of tomorrow.'),
        h('Two sides, one print'),
        p('Someone wants to buy. Someone wants to sell. When their prices meet, a trade prints, and that print becomes the last price on the terminal. If buyers are more urgent, they pay the offer and the print moves up. If sellers are more urgent, they hit the bid and the print moves down.'),
        p('Urgency can come from news, from a fund that must rebalance, from a stop that just fired, or from a reason you will never see. The chart records the trades. It does not record the motives.'),
        h('What can change the agreement'),
        ul(
          'New information about cash flows, interest rates, or risk.',
          'Forced flows: margin calls, index rebalances, option hedges.',
          'A change in how much risk people want to hold at all, even if no single company changed.',
        ),
        note('The number next to a symbol here is a quote from the feed, or the last saved snapshot if the feed is down. Either way it is a print, not a valuation.'),
        example(
          'A one-rupee disagreement',
          'Bid 100.00 for 500 shares. Ask 100.10 for 200 shares.',
          'A market buy of 200 shares pays 100.10.',
          'Last price is now 100.10. The bid can still be 100.00.',
          'The stock did not "become" worth 100.10. Two sides met there.',
        ),
      ],
      quiz: [
        {
          prompt: 'The last price on the screen is',
          choices: [
            'The company\'s official value, set once a day by the exchange',
            'The most recent price at which a buyer and a seller traded',
            'Tomorrow\'s expected open',
            'The average analyst target',
          ],
          answer: 1,
          why: 'The exchange matches orders. The last price is the last match.',
        },
        {
          prompt: 'A price can rise on a day with no company news because',
          choices: [
            'Prices are only allowed to move when earnings are released',
            'Buyers can be more urgent than sellers for reasons that are not in a headline',
            'The exchange nudges prices up to create volume',
            'A higher print means the balance sheet improved that minute',
          ],
          answer: 1,
          why: 'Flows, hedges, and risk appetite move prints all session. News is one input.',
        },
      ],
    },
    {
      slug: 'exchanges-and-brokers',
      title: 'Exchanges, brokers, and depositories',
      minutes: 6,
      blocks: [
        p('You do not send an order to "the market". You send it to a broker. The broker routes it to an exchange. A depository keeps the record that the shares are yours.'),
        h('Three different jobs'),
        ul(
          'The exchange (NSE or BSE for Indian equities) matches buy and sell orders and publishes the trades.',
          'The broker is your agent: account, orders, margins, and contract notes. The broker is not the market.',
          'The depository (NSDL or CDSL) holds securities in electronic form. Your demat account is that record.',
        ),
        p('A trading account and a demat account solve different problems. The trading account is how orders and funds move. The demat account is where delivered shares sit. Intraday trades that you close the same day often never become a demat credit. Delivery buys do.'),
        h('What the exchange does not do'),
        p('It does not pick a fair price, and it does not guarantee that you can exit at the last price you saw. It guarantees a rulebook: whose order is ahead, what the tick size is, and when the session is open. If you and the person on the other side both want out at once, the next price can be far from the last one.'),
        note('This terminal is not a broker and not an exchange. Orders you place here are simulated. Nothing is routed, and nothing lands in a demat account.'),
      ],
      quiz: [
        {
          prompt: 'Who matches a buy order with a sell order?',
          choices: [
            'The depository',
            'The exchange',
            'Your bank',
            'The company whose shares you bought',
          ],
          answer: 1,
          why: 'NSE or BSE runs the matching engine. The depository records ownership after settlement.',
        },
        {
          prompt: 'A demat account is where',
          choices: [
            'Intraday profits are calculated',
            'Delivered shares are held electronically',
            'The exchange stores unmatched orders',
            'Analyst reports are filed',
          ],
          answer: 1,
          why: 'Demat is custody. The order book lives at the exchange, not in your demat.',
        },
      ],
    },
    {
      slug: 'what-you-can-trade',
      title: 'Shares, indices, and what this terminal shows',
      minutes: 5,
      blocks: [
        p('A share is a slice of one company. An index is a recipe: a weighted list of shares, republished as a single number. You can study both. You cannot always trade them the same way.'),
        h('The cash market'),
        p('In the cash segment you buy or sell the share itself. Buy and hold it, and you are a part-owner, last in line after employees, suppliers, lenders, and the tax office. Sell it the same day and you were only in the price for a few hours. The chart looks identical either way. The risk is not.'),
        h('An index is not a share'),
        p('Nifty 50 and Sensex are averages with published rules. You cannot take delivery of "one Nifty" the way you take delivery of one share. People trade the index through futures, options, and funds that track it. When the terminal shows an index, read it as a summary of many prints, not as a thing you own.'),
        note('Symbols on the dashboard are instruments this app knows how to quote. A quote is not a recommendation, and a missing symbol is not a verdict on the company.'),
      ],
      quiz: [
        {
          prompt: 'An index such as the Nifty 50 is',
          choices: [
            'A company listed on the NSE',
            'A published average of many shares, following a rulebook',
            'A futures contract by itself',
            'The exchange\'s profit for the day',
          ],
          answer: 1,
          why: 'The index is a calculation. Futures and funds are separate instruments that refer to it.',
        },
        {
          prompt: 'Buying a share in the cash market and holding it means',
          choices: [
            'You own a residual claim on that company',
            'The company must buy it back at your purchase price',
            'You are guaranteed a dividend',
            'You have sold insurance to the market',
          ],
          answer: 0,
          why: 'Equity is the residual claim. Dividends, buybacks, and the resale price are all uncertain.',
        },
      ],
    },
    {
      slug: 'the-order-book',
      title: 'Bids, asks, and the spread',
      minutes: 6,
      blocks: [
        p('Behind the last price is a queue. Buyers line up on the bid, each with a price and a quantity. Sellers line up on the ask. The gap between the best bid and the best ask is the spread.'),
        h('Who pays the spread'),
        p('A marketable buy order pays the ask. A marketable sell order hits the bid. Cross the spread and you have already given up the difference, before any fee. On a liquid name the spread may be one tick. On a thin name it can be a large fraction of the price, and your "signal" can be smaller than the toll to enter and leave.'),
        h('Size matters as much as price'),
        p('The best ask might show 50 shares. If you buy 5,000, you walk up the book and your average price is worse than the price you saw. That is slippage. This terminal\'s paper fills charge a small adverse slippage on purpose, so a backtest does not pretend you were filled at the touch in size.'),
        example(
          'Walking the book',
          'Ask: 250.00 × 50, then 250.20 × 400, then 250.50 × 2,000',
          'A market buy of 50 shares averages 250.00',
          'A market buy of 2,450 shares averages much closer to 250.50',
          'Same last price. Different trade.',
        ),
        note('Limit orders wait. They do not promise a fill. A limit to buy below the ask sits in the queue until someone is willing to sell there, or until you cancel it.'),
      ],
      quiz: [
        {
          prompt: 'The spread is',
          choices: [
            'The distance between the best bid and the best ask',
            'The gap between today\'s open and yesterday\'s close',
            'The brokerage invoice',
            'The difference between RSI and price',
          ],
          answer: 0,
          why: 'Best bid to best ask. You pay it when you demand an immediate fill.',
        },
        {
          prompt: 'Slippage gets worse when',
          choices: [
            'Your order is small relative to the shares shown at the touch',
            'Your order is larger than the quantity available at the best price',
            'The company pays a dividend',
            'You use a limit order that is never reached',
          ],
          answer: 1,
          why: 'Size beyond the touch fills at worse prices. An unfilled limit has no slippage because it has no fill.',
        },
      ],
    },
    {
      slug: 'a-session',
      title: 'A session on the NSE',
      minutes: 5,
      blocks: [
        p('The cash market is not open all night. Most of the prints you study happen in one window, India time, with a short ceremony at each end.'),
        h('The shape of the day'),
        ul(
          'A pre-open window collects orders and discovers an opening price, instead of letting the first click set the open.',
          'The regular session is the continuous auction, roughly 9:15 to 15:30 IST, where the book matches as orders arrive.',
          'After the close there is a short window for a limited kind of order. It is not a second full session.',
        ),
        p('The exchange publishes the exact clock, and it can change the clock. Learn the shape, then check the current circular before you plan a live order around the bell. Circuit limits can also halt a name for part of the day: the book is still there, but it is not allowed to print beyond a band.'),
        h('Why the open feels violent'),
        p('Overnight news has no continuous auction to absorb it. The pre-open compresses that disagreement into one price. The first minutes after 9:15 are often wide because the overnight queue is still being digested. A signal that only "works" in those minutes is a different strategy from one that works at noon, and it should be tested as such.'),
        note('Charts on this terminal mix live prints with the last snapshot when the feed is quiet. A flat line can mean "no new trade" or "no new data". Read the feed status in the top bar before you read the candle.'),
      ],
      quiz: [
        {
          prompt: 'The regular continuous session on the NSE cash market is roughly',
          choices: [
            'Open all night, like a currency dealing room',
            '9:15 to 15:30 India time, with a pre-open before it',
            'Only the last hour of the day',
            'Whenever a broker decides to accept orders',
          ],
          answer: 1,
          why: 'That is the ordinary cash session. Exact timings are the exchange\'s, and they do change.',
        },
        {
          prompt: 'A circuit limit',
          choices: [
            'Forces the price to the analyst target',
            'Stops the price from printing beyond a band for a period',
            'Cancels every derivative contract',
            'Guarantees you can exit at the previous close',
          ],
          answer: 1,
          why: 'The band pauses price discovery outside a range. It does not promise you a fill at the last price.',
        },
      ],
    },
    {
      slug: 'paper-before-money',
      title: 'Paper before money',
      minutes: 5,
      blocks: [
        p('Paper trading is a rehearsal with a real script and a fake audience. The prices can be real. The fear, the margin call from your bank, and the tax invoice are not.'),
        h('What this terminal does simulate'),
        ul(
          'Quotes, when the feed or the last snapshot is available.',
          'Orders against those quotes, with a small slippage cost so fills are not free.',
          'A virtual cash balance and positions that persist on your account.',
        ),
        h('What it cannot simulate'),
        p('It cannot simulate the size of your real savings, a broker\'s margin call on a bad morning, or the way a plan changes after a loss you can feel. People who are profitable on paper and chaotic with money are not suffering a software bug. The missing variable is them.'),
        p('Use the modules after this one to learn the instruments. Use Paper Lab to see whether a rule still looks sensible after costs. Treat a good paper month as permission to keep studying, not as permission to skip the risk module.'),
        note('Nothing on this site is a broker, an advisor, or an exchange. No order here reaches the NSE or the BSE.'),
      ],
      related: [{ to: '/paper', label: 'Open Paper Lab' }],
      quiz: [
        {
          prompt: 'A profitable paper month is evidence that',
          choices: [
            'The same orders would have made the same money with real size and real nerves',
            'The rule survived this terminal\'s quotes and a small slippage cost, for that sample',
            'The exchange has approved the strategy',
            'Taxes and margin can be ignored',
          ],
          answer: 1,
          why: 'Paper tests the rule against prices and a simple cost. It does not test you, your size, or your broker\'s rulebook.',
        },
        {
          prompt: 'This terminal sends orders to',
          choices: [
            'The NSE matching engine',
            'A simulated paper broker only',
            'Your demat account',
            'Whichever broker you typed into settings',
          ],
          answer: 1,
          why: 'Fills are simulated. There is no live order route.',
        },
      ],
    },
  ],
};
