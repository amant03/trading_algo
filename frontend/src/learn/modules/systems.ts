import type { Module } from '../types';
import { example, h, note, p, ul } from '../blocks';

export const systems: Module = {
  slug: 'systems',
  title: 'Trading systems',
  blurb: 'A rule is a bet you can audit. Backtests lie in particular ways, and a paper fill is the first honest argument.',
  level: 'Advanced',
  chapters: [
    {
      slug: 'a-bet',
      title: 'A rule is a bet',
      minutes: 6,
      blocks: [
        p('A trading system is a hypothesis with the pronouns removed. "I think it bounces" is not a system. "If the close is below the lower band and the next open is still below it, buy, and exit when the close is back above the average" is a system. Someone else can run it and get your trades.'),
        h('The four lines'),
        ul(
          'Entry: the condition that opens the risk, including the instrument and the timeframe.',
          'Exit: both the "I was wrong" exit and the "I was right, now leave" exit. A system with only one of them is a hope.',
          'Size: the rupees at risk, from the previous module, not a quantity you like the look of.',
          'Filter: when the rule is not allowed to fire. A quiet filter — no earnings, no first five minutes, no thin names — saves more accounts than a clever entry.',
        ),
        p('If you cannot write the four lines, you do not yet have a disagreement with the market. You have a mood. Moods cannot be backtested, which is why they feel successful: there is no record of the version you abandoned.'),
        note('The strategies on the Algorithms page are written rules of this kind. Read them as hypotheses with a track record inside this app, not as instructions.'),
      ],
      related: [{ to: '/algorithms', label: 'Read the algorithms' }],
      quiz: [
        {
          prompt: 'A system differs from a hunch because',
          choices: [
            'It uses more indicators',
            'Someone else could apply the entry, the exit, and the size and get the same trades',
            'It never loses',
            'It ignores costs',
          ],
          answer: 1,
          why: 'A rule is auditable. A hunch changes in the retelling.',
        },
        {
          prompt: 'A system that names an entry and no invalidation',
          choices: [
            'Is complete, because the exit can be decided later',
            'Is unfinished. The wrong-case is part of the hypothesis',
            'Has no need for size',
            'Is a hedge',
          ],
          answer: 1,
          why: 'Without an exit for being wrong, the position\'s life is a negotiation you will hold with yourself later.',
        },
      ],
    },
    {
      slug: 'the-terminal',
      title: 'How to read a strategy on this terminal',
      minutes: 5,
      blocks: [
        p('This app computes classic indicators and runs several named strategies over them. A marker on a chart is the strategy\'s rule firing on the candles it could see. It is not a person who looked at the news and changed their mind.'),
        h('What you should ask a marker'),
        ul(
          'Which rule fired, and on which timeframe.',
          'What the exit is, not only the entry.',
          'What the sample looks like after costs: a run of markers is not a result.',
          'Whether you would have taken the losers as well as the one you are staring at.',
        ),
        p('Cherry-picking the marker that worked is the same error as rewriting a hunch. The strategy includes the marks you would rather hide. Paper Lab is where a rule meets a fill. The marker by itself is an advertisement the rule printed.'),
        note('Auto-trading inside the paper broker, when it is on, still uses simulated fills and its own position caps. Those caps are guardrails for the simulation. They are not a personal risk sheet.'),
      ],
      related: [{ to: '/paper', label: 'Open Paper Lab' }],
      quiz: [
        {
          prompt: 'A strategy marker on a chart means',
          choices: [
            'An analyst upgraded the stock',
            'A written rule matched the candles the app could see',
            'The exchange recommends the trade',
            'The fill has already made money',
          ],
          answer: 1,
          why: 'The marker is the rule. The outcome of taking every marker is a different question, answered by the whole sample.',
        },
        {
          prompt: 'Judging a strategy by the one signal that worked',
          choices: [
            'Is the correct way to read a backtest',
            'Throws away the losers that belong to the same rule',
            'Removes slippage',
            'Is required before paper trading',
          ],
          answer: 1,
          why: 'The rule is the set of trades. The flattering subset is not a strategy you can run, because you do not know it is the subset until afterwards.',
        },
      ],
    },
    {
      slug: 'backtests-lie',
      title: 'How a backtest lies',
      minutes: 7,
      blocks: [
        p('A backtest asks what a frozen rule would have done on old data. That is a fair question. The lies arrive in how the rule got frozen, and in what the old data quietly assumed.'),
        h('The usual lies'),
        ul(
          'Overfit: the rule was tuned until the past looked good. The parameters memorised accidents. A new month is not obliged to repeat the accident.',
          'Lookahead: the test used a number that, on the day, you did not have yet. Tomorrow\'s close, a revised filing, a universe of survivors.',
          'Survivorship: the test only includes firms that exist today, so the ones that died and would have stopped you out never appear.',
          'One path: a single equity curve is one history. It is not the distribution of histories you might have lived.',
        ),
        p('A clean habit is to choose the rule on one period and touch it as little as possible on a later period you did not use for tuning. If the later period is dull, believe the dullness. The pretty period already had its chance to persuade you.'),
        example(
          'Lookahead, small and fatal',
          'Rule: buy if today\'s close is in the top 10% of the day\'s range.',
          'Fine, if you trade after the close.',
          'Fatal, if the backtest assumed you bought at the open of that same day.',
          'The open did not know the close. The test pretended it did.',
        ),
      ],
      quiz: [
        {
          prompt: 'Overfitting is',
          choices: [
            'Including brokerage in the test',
            'Tuning a rule until it memorises accidents in the sample you optimised on',
            'Using too few indicators',
            'Marking to market',
          ],
          answer: 1,
          why: 'The past has patterns that will not recur. A search over many rules will find them and call them an edge.',
        },
        {
          prompt: 'A backtest that buys at the open using that day\'s close has',
          choices: [
            'A conservative cost assumption',
            'Lookahead: it used information the open did not have',
            'No bias, because both numbers are real',
            'Solved slippage',
          ],
          answer: 1,
          why: 'Both prints happened. The order of time is the point. The open comes first.',
        },
      ],
    },
    {
      slug: 'costs',
      title: 'Costs and the size of the sample',
      minutes: 6,
      blocks: [
        p('An edge is what is left after the spread, slippage, fees, and the taxes a real account would owe. A signal that makes a few ticks and trades all day can be a machine for paying the spread.'),
        h('Count the toll'),
        p('Every round trip crosses the spread at least once in spirit, often twice in fact, and pays whatever your broker and the state charge. This terminal\'s paper fills add a small adverse slippage so the toll is not zero. If a rule only works with the slippage turned off, it does not work.'),
        h('Count the trades'),
        p('Twenty trades is an anecdote. A rule that wins 55% of the time can easily show 8 wins in 10 tries, or 3. You need enough trades that one lucky week cannot be the whole argument — and you need them out of sample, after costs. There is no magic count. There is a duty to notice when the count is embarrassing.'),
        example(
          'A busy rule, a quiet result',
          'Average win before costs: 0.15% per trade.',
          'Spread, slippage, and charges: 0.12% per round trip.',
          'What remains is 0.03%, before you are wrong, and before a single gap.',
          'The indicator was never the product. The toll was.',
        ),
      ],
      quiz: [
        {
          prompt: 'A rule that is profitable only when slippage is set to zero',
          choices: [
            'Is ready for a real account',
            'Is paying its edge back to the spread',
            'Has been proven out of sample',
            'Does not need an exit',
          ],
          answer: 1,
          why: 'Real fills do not happen at the mid. If the edge is thinner than the toll, the edge is the toll.',
        },
        {
          prompt: 'A short winning streak proves',
          choices: [
            'The win rate, to several decimal places',
            'Little. A modest edge produces streaks in both directions',
            'That costs can be ignored',
            'That the rule was not overfit',
          ],
          answer: 1,
          why: 'Small samples move a lot. The streak is allowed. It is not a measurement.',
        },
      ],
    },
    {
      slug: 'paper-is-the-test',
      title: 'Paper is the first honest argument',
      minutes: 5,
      blocks: [
        p('After a rule is written and a backtest has not obviously cheated, the next argument is a paper account you do not touch. Same size rule, same exits, a journal of every time you wanted to interfere.'),
        h('What paper is allowed to teach'),
        ul(
          'Whether you can stand the losers that were always part of the sample.',
          'Whether the fills, with slippage on, still resemble the test.',
          'Whether you break the sheet in module six the first week it is inconvenient.',
        ),
        h('What paper is not allowed to teach'),
        p('It is not allowed to teach you that you are ready for leveraged size. It has not met your rent, your broker\'s square-off, or a loss that changes your sleep. Promote size slowly, in cash you can lose, after the paper record includes a dull month and a bad month. Skip that and you are not being bold. You are refusing the only evidence that was cheap to collect.'),
        note('Promotion, if it ever happens, happens at a broker, under their risk rules, with money you can lose. This website does not place that order.'),
      ],
      related: [{ to: '/paper', label: 'Open Paper Lab' }],
      quiz: [
        {
          prompt: 'The point of a hands-off paper run is to see',
          choices: [
            'The best single trade, up close',
            'Whether you can follow the rule, including its losers, once fills and slippage are real enough to annoy you',
            'Whether the exchange will whitelist the strategy',
            'The fair value of the company',
          ],
          answer: 1,
          why: 'The backtest assumed obedience. Paper is where obedience meets a person.',
        },
        {
          prompt: 'A good paper month is a reason to',
          choices: [
            'Skip the risk sheet and trade full size',
            'Keep the record going, including a period that is not flattering, before any real size',
            'Turn off slippage',
            'Stop writing the exit down',
          ],
          answer: 1,
          why: 'One good month is a sample. Size comes after the sample includes boredom and loss.',
        },
      ],
    },
  ],
};
