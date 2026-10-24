import type { Module } from '../types';
import { example, h, note, p, ul } from '../blocks';

export const charts: Module = {
  slug: 'charts',
  title: 'Technical analysis',
  blurb: 'Candles, trend, and the indicators this terminal already computes — and the claims they do not support.',
  level: 'Beginner',
  chapters: [
    {
      slug: 'candles',
      title: 'How a candle is built',
      minutes: 6,
      blocks: [
        p('A candle compresses a slice of time into four numbers: the first print (open), the last print (close), the highest print (high), and the lowest print (low). Everything else that happened inside the slice is thrown away.'),
        h('Body and wicks'),
        p('The body is the distance from open to close. A filled or red body, in the usual Indian convention, closed below its open. A hollow or green body closed above its open. The wicks are the extremes the price visited and then left. A long lower wick says the low found buyers before the slice ended. It does not say those buyers will still be there in the next slice.'),
        h('The lie inside every candle'),
        p('Two sessions can share the same open, high, low, and close and have completely different stories: a quiet drift, or a crash that recovered. On a daily chart you cannot tell them apart. That is why a pattern is a description, not a mechanism. "Hammer", "engulfing", and "doji" are names for shapes. The shape is real. The prediction people attach to the name is a hypothesis you still have to test.'),
        example(
          'Same candle, two paths',
          'Open 100, high 110, low 90, close 108.',
          'Path A: a steady climb from 100 to 108.',
          'Path B: a fall to 90, then a squeeze back to 108.',
          'The daily candle is identical. The risk of holding through path B was not.',
        ),
        note('Shorter candles keep more of the path and add more noise. Longer candles hide the path and look calmer than the day felt.'),
      ],
      quiz: [
        {
          prompt: 'A candle\'s body measures',
          choices: [
            'Volume traded in the slice',
            'The distance between the open and the close',
            'The distance between the high and the low',
            'How many shares are outstanding',
          ],
          answer: 1,
          why: 'High to low is the full range, including wicks. The body is open to close.',
        },
        {
          prompt: 'Two days with the same OHLC',
          choices: [
            'Must have felt the same to someone who held through them',
            'Can hide completely different paths inside the day',
            'Prove that a reversal pattern will work tomorrow',
            'Mean the order book was empty',
          ],
          answer: 1,
          why: 'OHLC throws away the path. The shape is a summary, not the whole auction.',
        },
      ],
    },
    {
      slug: 'trend-and-levels',
      title: 'Trend, support, and resistance',
      minutes: 6,
      blocks: [
        p('A trend is a description of the recent path: higher highs and higher lows, or the opposite. Support and resistance are prices where the path paused before. They are memories of the auction, not fences the exchange agreed to defend.'),
        h('Why a level sometimes "works"'),
        p('Many people can see the same high. Some place sells there because last time the price failed. Some place stops just beyond it. When the crowd uses the same memory, orders cluster, and the cluster can slow the price. The level did not cause the orders. The shared memory did. If the memory is crowded, the level is fragile: the stops on the other side become fuel once they break.'),
        h('Trend is not a force'),
        p('"The trend is your friend" is a slogan about not fighting a path that is already underway. It is not a law. Trends end, and the end looks like a trend until it doesn\'t. A useful rule names what would prove you wrong — a lower low, a lost moving average, a failed break — before you need the proof.'),
        ul(
          'Mark levels from obvious swings, not from every tick.',
          'Prefer zones (a band) to a single rupee, because fills were never that precise.',
          'Write down what a break means before the break happens.',
        ),
        note('A horizontal line on a chart is a hypothesis about where orders might cluster. It is not a prediction that they will.'),
      ],
      quiz: [
        {
          prompt: 'Support is best treated as',
          choices: [
            'A price the exchange is obliged to defend',
            'A prior area where enough buyers appeared to pause the decline',
            'The 52-week low, always',
            'A fundamental fair value',
          ],
          answer: 1,
          why: 'It is a memory of past trades. Whether buyers show up again is a new auction.',
        },
        {
          prompt: 'A widely watched level can break violently because',
          choices: [
            'Stops clustered on the other side become market orders when they trigger',
            'The company files its annual report at that price',
            'Volume is required to be zero at a round number',
            'Moving averages cannot be crossed',
          ],
          answer: 0,
          why: 'The same memory that defends a level piles stops beyond it. A break can release those stops.',
        },
      ],
    },
    {
      slug: 'moving-averages',
      title: 'Moving averages',
      minutes: 6,
      blocks: [
        p('A moving average is the mean of the last N closes. It lags, on purpose. It cannot turn before the price does, because it is made of the price.'),
        h('Simple and exponential'),
        p('A simple average weights the last N closes equally, then forgets the close that falls out of the window. An exponential average weights recent closes more, so it hugs the price tighter and twitches more. Neither is "more correct". One is smoother. One is quicker. Quicker means more false turns.'),
        h('Crossovers'),
        p('A short average crossing above a long one says recent closes have been stronger than older closes. That is a description of the past window. People turn it into a rule: buy the cross, exit on the reverse cross. The rule\'s problem is the lag. In a choppy market the cross arrives after the move, and the reverse cross arrives after the give-back. You donate the spread twice for a trip that netted nothing.'),
        example(
          'Lag, in one line',
          'Closes: 10, 10, 10, 10, 14. A 5-day average is 10.8.',
          'The last print was 14. The average still says "about 11".',
          'The average will catch up only if 14 persists.',
        ),
        note('On a stock page here, moving averages are computed from the candles the chart has. A short history makes a long average mostly empty. Do not read a half-built average as a signal.'),
      ],
      quiz: [
        {
          prompt: 'A moving average turns',
          choices: [
            'Before the price, because it is predictive',
            'After the price, because it is an average of past closes',
            'Only on earnings day',
            'When volume doubles',
          ],
          answer: 1,
          why: 'It is a lagging summary. Any signal built from it inherits the lag.',
        },
        {
          prompt: 'An exponential average differs from a simple one because',
          choices: [
            'It uses volume instead of price',
            'It gives more weight to recent closes',
            'It ignores the last candle',
            'It is required by the exchange',
          ],
          answer: 1,
          why: 'Recent closes count more, so the line reacts faster and whipsaws more.',
        },
      ],
    },
    {
      slug: 'rsi',
      title: 'RSI is a speedometer',
      minutes: 6,
      blocks: [
        p('The relative strength index compares the size of recent up-closes with the size of recent down-closes, then squeezes the result onto a scale from 0 to 100. It measures how one-sided the recent path has been. It does not measure value.'),
        h('70 and 30 are labels, not alarms'),
        p('A common setting calls 70 "overbought" and 30 "oversold". In a strong trend, RSI can sit above 70 for weeks while the price keeps rising. Selling because a label says overbought is a bet that the trend is tired. Sometimes it is. The indicator has not proved it. The interesting event is often a disagreement: price makes a new high, RSI does not. That is called divergence. It is another description, and it fails often enough that it needs a rule for when you are wrong.'),
        h('The window is the product'),
        p('A 14-period RSI on a daily chart looks at a different past than a 14-period RSI on a 5-minute chart. People quote "RSI is 75" as if it were a fact about the company. It is a fact about one window of closes. Change the window and the number changes.'),
        note('This terminal plots RSI from the candles it has loaded. Compare it with the same window you used when you studied the rule. A number without a window is not a signal.'),
      ],
      related: [{ to: '/', label: 'Open the dashboard' }],
      quiz: [
        {
          prompt: 'RSI above 70 means',
          choices: [
            'The company is expensive on earnings',
            'Recent up-closes have dominated recent down-closes, on that window',
            'You must sell',
            'Volume has dried up',
          ],
          answer: 1,
          why: 'It is a normalised reading of recent close-to-close direction, not a valuation.',
        },
        {
          prompt: 'RSI can stay "overbought" during a strong rally because',
          choices: [
            'The formula breaks above 70',
            'A trend is exactly the case where up-closes keep dominating',
            'The exchange caps the price but not the indicator',
            'Dividends are included in the high',
          ],
          answer: 1,
          why: 'The label describes one-sided closes. A trend is one-sided closes. The label can stay on while the trend continues.',
        },
      ],
    },
    {
      slug: 'macd-and-bands',
      title: 'MACD and Bollinger Bands',
      minutes: 7,
      blocks: [
        p('Both of these are built from moving averages. They feel more sophisticated than an average. They inherit the same lag, and they answer different questions.'),
        h('MACD'),
        p('MACD subtracts a slower exponential average from a faster one. The difference is the MACD line. An average of that difference is the signal line. The histogram is the gap between them. A cross says the faster average has changed its lead over the slower one. In a trend, the histogram staying on one side of zero is the whole message: recent momentum still agrees with the cross. In a range, the cross chatters.'),
        h('Bollinger Bands'),
        p('A middle band is an average. The outer bands sit a couple of standard deviations away, so they widen when recent closes have been wild and tighten when recent closes have been quiet. A touch of the upper band is not a sell. In a trend, price can walk the band. A touch is only interesting relative to a rule you wrote in advance: fade the band in a range, or buy a break after a squeeze. Those are opposite rules. The indicator does not choose between them.'),
        example(
          'A squeeze is not a direction',
          'Bands tighten after a quiet fortnight.',
          'The next expansion can be up or down.',
          'The squeeze said "a larger move is more likely than the recent quiet".',
          'It did not say which way.',
        ),
        note('If MACD and the price disagree, you do not have a mystery. You have two summaries of the same closes. Decide which rule you are following before you click.'),
      ],
      quiz: [
        {
          prompt: 'The MACD histogram is',
          choices: [
            'Volume minus average volume',
            'The gap between the MACD line and its signal line',
            'The company\'s earnings surprise',
            'The bid-ask spread',
          ],
          answer: 1,
          why: 'MACD is a difference of averages. The histogram is how far that difference sits from its own average.',
        },
        {
          prompt: 'Price touching the upper Bollinger Band',
          choices: [
            'Is a standing order to sell',
            'Means recent closes are far above their average, relative to recent volatility',
            'Means the stock has reached intrinsic value',
            'Closes the market for the day',
          ],
          answer: 1,
          why: 'The band is a volatility envelope around an average. Touching it is a location, not an instruction.',
        },
      ],
    },
    {
      slug: 'volume',
      title: 'Volume, and what it cannot tell you',
      minutes: 5,
      blocks: [
        p('Volume is how many shares (or contracts) printed in the slice. It measures participation. It does not measure whether the participants were right.'),
        h('A useful reading'),
        p('A price break on tiny volume is a break few people attended. It can still be real, and it can also reverse the moment size shows up. A break on heavy volume means a lot of inventory changed hands at the new prices. That is harder to dismiss, and it is still not a forecast. Heavy volume on a down day can be panic, or it can be a large buyer quietly taking everything the sellers will throw.'),
        h('What volume hides'),
        ul(
          'You rarely know whether the aggressive side was the buyer or the seller. The print has no name.',
          'Index rebalances and derivative hedges create volume that has nothing to do with a view on the company.',
          'A stock can trend for a long time on ordinary volume. Waiting for a "volume confirmation" can mean missing the path you claimed to want.',
        ),
        note('Compare volume with that symbol\'s own recent volume, not with another company\'s. A small stock\'s busy day can be a large stock\'s quiet minute.'),
      ],
      quiz: [
        {
          prompt: 'High volume on a down move tells you that',
          choices: [
            'The company is certainly failing',
            'A lot of shares changed hands while the price fell — not who was glad about it',
            'RSI must be below 30',
            'The trend has ended',
          ],
          answer: 1,
          why: 'Volume counts prints. It does not label the buyer as informed or the seller as forced.',
        },
        {
          prompt: 'A breakout on very low volume is',
          choices: [
            'Always false',
            'A move few participants joined, so it deserves more scepticism, not an automatic cancel',
            'Illegal',
            'Proof of insider buying',
          ],
          answer: 1,
          why: 'Thin participation makes a print easier to reverse. It does not, by itself, make the print unreal.',
        },
      ],
    },
  ],
};
