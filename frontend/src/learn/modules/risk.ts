import type { Module } from '../types';
import { example, h, note, p, ul } from '../blocks';

export const risk: Module = {
  slug: 'risk',
  title: 'Risk and psychology',
  blurb: 'Size the loss first. The chart is the easy part; the account and the person holding it are the constraint.',
  level: 'Intermediate',
  chapters: [
    {
      slug: 'size',
      title: 'Size the loss first',
      minutes: 6,
      blocks: [
        p('Position size is the only part of a trade you fully choose. The market chooses the path. You choose how much of the account that path is allowed to touch.'),
        h('From the loss, not from the excitement'),
        p('Decide the rupees you are willing to lose if the idea is wrong. Decide the price at which the idea is wrong. The size is those rupees divided by the distance to that price. A tight "I am wrong" level allows a larger quantity. A wide one forces a smaller quantity. People do the reverse: they pick a quantity that feels meaningful, then discover the loss.'),
        p('A common classroom rule is to risk a fraction of one percent of equity on a single idea. It is a classroom rule, not a law, and it is deliberately boring. The point is that ruin is a sizing choice. One enormous bet can end a year of careful ones.'),
        example(
          'Quantity from a loss',
          'Equity ₹10,00,000. You will risk 0.5% = ₹5,000.',
          'Entry 250. You are wrong at 240. Distance = ₹10 a share.',
          'Quantity = 5,000 / 10 = 500 shares.',
          'If you wanted 2,000 shares, you do not have a bigger opportunity. You have a ₹20,000 loss.',
        ),
        note('Paper Lab can fill a size your nerves would never hold. If you would not take the loss in cash, the paper profit is a different strategy from the one you will actually run.'),
      ],
      quiz: [
        {
          prompt: 'Position size should be computed from',
          choices: [
            'How sure you feel',
            'The cash you can lose, divided by the distance to the price that proves you wrong',
            'The lot the exchange wishes you would trade',
            'Yesterday\'s volume',
          ],
          answer: 1,
          why: 'Feeling is not a denominator. The invalidation price and the rupee loss are.',
        },
        {
          prompt: 'A tighter invalidation price',
          choices: [
            'Forces a smaller quantity, always',
            'Allows a larger quantity for the same rupee risk, and gets you out sooner if it is hit',
            'Removes the need for a stop',
            'Increases the spread',
          ],
          answer: 1,
          why: 'Same rupees, shorter distance, more shares. The trade-off is that noise can hit a tight level.',
        },
      ],
    },
    {
      slug: 'stops',
      title: 'Stops, gaps, and the hole they leave',
      minutes: 5,
      blocks: [
        p('A stop is an order to get out when the price reaches a level you chose while you were calm. It is a tool against yourself as much as against the market. It is not a guarantee of the price.'),
        h('The hole'),
        p('A stop-loss sell becomes a marketable order when the trigger prints. If the next trade is far through your trigger — a gap at the open, a circuit, a thin book — you are filled at the next price the book allows, not at the trigger. The loss you sized was a hope about the path. The gap is the path refusing.'),
        p('That is why sizing from a stop still needs a worse case. Ask what the open can do. If a gap through the stop would hurt more than the plan allows, the quantity is still too big, or the instrument is too violent for the account.'),
        note('Cancelling a stop because the price is "about to bounce" is a new trade, made under stress, with no written invalidation. Treat it as a new decision and write it down, or do not take it.'),
      ],
      quiz: [
        {
          prompt: 'A stop-loss guarantees',
          choices: [
            'A fill at the trigger price',
            'Nothing about the fill. It guarantees an attempt to exit once the trigger is reached',
            'That the thesis was correct',
            'A hedge',
          ],
          answer: 1,
          why: 'The trigger releases an order. The book decides the price, especially through a gap.',
        },
        {
          prompt: 'You cancel a stop because you now expect a bounce. That is',
          choices: [
            'Still the original plan',
            'A new decision, made while the position is going against you',
            'Required by the exchange',
            'A way to reduce size',
          ],
          answer: 1,
          why: 'The plan included the exit. Removing it is a different plan and should be judged as one.',
        },
      ],
    },
    {
      slug: 'drawdown',
      title: 'The math of getting back',
      minutes: 5,
      blocks: [
        p('A loss and the gain required to undo it are not the same percentage. The denominator shrinks. This is arithmetic, and it is the reason deep holes end careers that "only" had a few bad months.'),
        example(
          'The hole is asymmetric',
          'Start at 100.',
          'Lose 10%: you have 90. You need +11.1% to get back.',
          'Lose 50%: you have 50. You need +100% to get back.',
          'Lose 80%: you have 20. You need +400% to get back.',
        ),
        p('A strategy that makes 15% in a good year and can lose 50% in a bad one is not "ahead on average" in any way that helps the person who has to live the bad year. They now need a triple-digit recovery from a strategy that, in its own marketing, makes fifteen. The average hid the path. The path is what hits the account.'),
        p('This is also why a string of small losses is kinder than one spectacular one, even when the spectacular one is "the same expected value" in a spreadsheet. You can survive the string long enough to find out if the edge was real.'),
        note('Drawdown is measured from the peak, not from the amount you originally deposited. A new high resets the peak. The next loss is judged from there.'),
      ],
      quiz: [
        {
          prompt: 'After a 50% loss, getting back to the peak requires',
          choices: [
            'A 50% gain',
            'A 100% gain',
            'A 25% gain',
            'No gain, because percentages are symmetric',
          ],
          answer: 1,
          why: 'Half of 100 is 50. Doubling 50 gets you to 100. The way back is larger than the way down.',
        },
        {
          prompt: 'Drawdown is measured from',
          choices: [
            'The original deposit only',
            'The highest equity the account reached',
            'The last losing trade alone',
            'The index',
          ],
          answer: 1,
          why: 'The peak is the reference. A gain that makes a new high starts the measurement over.',
        },
      ],
    },
    {
      slug: 'the-person',
      title: 'Revenge, FOMO, and doing nothing',
      minutes: 6,
      blocks: [
        p('The market does not know you had a loss. The next trade does not owe you a refund. Most of the damage after a bad trade is the attempt to invoice the market for it.'),
        h('Two common invoices'),
        ul(
          'Revenge: raising size to "make it back" before the day ends. The thesis is no longer the price. The thesis is your mood.',
          'FOMO: entering because the price already moved and other people seem to have been paid. You are buying their leftover risk at a worse price, with a worse stop, because waiting feels like losing.',
        ),
        h('Doing nothing is a position'),
        p('Cash is a decision to not be in the auction. It has an opportunity cost, and it does not have slippage, theta, or a margin call. A written plan that includes "no trade" as an outcome will feel dull and will survive longer than a plan that must express an opinion every morning.'),
        p('If you cannot describe the trade without referring to the last trade\'s result, you are not looking at this trade. Close the terminal. The session will still be there.'),
        note('A journal is not a diary of feelings. It is a record of the rule, the size, the exit you promised, and whether you obeyed it. Feelings can have one line. They do not get to edit the rule after the fill.'),
      ],
      quiz: [
        {
          prompt: 'Raising size to recover a morning\'s loss means',
          choices: [
            'The edge just improved',
            'The next trade is being asked to pay for the last one, which is a change of plan',
            'The exchange rebates the first loss',
            'Drawdown math no longer applies',
          ],
          answer: 1,
          why: 'The market does not keep a tab. A larger size is a new, worse, risk decision.',
        },
        {
          prompt: 'Cash is',
          choices: [
            'A failure to participate',
            'A position with no slippage and no obligation to have a view',
            'Illegal in a trading account',
            'The same risk as a short option',
          ],
          answer: 1,
          why: 'Flat is an allowed state. A plan that cannot be flat is a plan that will invent trades.',
        },
      ],
    },
    {
      slug: 'a-sheet',
      title: 'A one-page risk sheet',
      minutes: 5,
      blocks: [
        p('Write this before the session, on one page, and do not negotiate it after a fill. If it does not fit on a page, you do not have a plan. You have a pile of indicators.'),
        h('The page'),
        ul(
          'What you are allowed to trade, and what you are not. Name the instruments.',
          'The rupee loss that ends a single idea, and the rupee loss that ends the day.',
          'The price that proves the idea wrong, and the order that will act on it.',
          'The maximum number of ideas open at once.',
          'The time after which you do not open anything new.',
          'One sentence on what you will do after a loss: size unchanged, or done for the day. Pick now.',
        ),
        p('Pin the page. When you want to break it, the desire is the data. You are learning whether you can follow a rule, which is the skill underneath every strategy in the next module.'),
        note('This terminal cannot see your page. The algorithms it runs have their own size caps. Those caps are not a substitute for yours.'),
      ],
      quiz: [
        {
          prompt: 'A risk sheet should be written',
          choices: [
            'After the loss, so it matches what you actually did',
            'Before the session, while the loss is still hypothetical',
            'By the broker, as part of the contract note',
            'Only if you trade options',
          ],
          answer: 1,
          why: 'The point is to decide while you are calm. A sheet written after the fact is a diary.',
        },
        {
          prompt: 'If the plan does not fit on one page',
          choices: [
            'You need a longer document and more indicators',
            'You probably have not chosen which rule you will obey',
            'The exchange will reject the orders',
            'Position size no longer matters',
          ],
          answer: 1,
          why: 'A page forces a choice. A pile of conditions lets you pick, after the fact, the one that flatters the trade.',
        },
      ],
    },
  ],
};
