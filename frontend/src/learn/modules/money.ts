import type { Module } from '../types';
import { h, note, p, ul } from '../blocks';

export const money: Module = {
  slug: 'money',
  title: 'Money around the market',
  blurb: 'What to fund first, what a fund is for, how Indian equity gains are bucketed, and a checklist before you size up.',
  level: 'Beginner',
  chapters: [
    {
      slug: 'money-you-can-lose',
      title: 'Money you can lose',
      minutes: 5,
      blocks: [
        p('The market is a place to put money you can leave there, and whose loss would not change how you live. It is a bad place to put the rent, the emergency fund, or money you have promised to a date.'),
        h('A sane order'),
        ul(
          'Cash for near-term bills, outside the market.',
          'An emergency fund that would cover a job loss or a medical bill without forcing you to sell shares on a bad day.',
          'Insurance against a catastrophe you cannot fund yourself, bought as insurance and not as an investment.',
          'Only then, money whose job is to grow, and whose path you can stand.',
        ),
        p('People reverse the list because the market is more interesting than an emergency fund. The interesting part is also the part that can demand cash on a Tuesday. If the only cash you have is inside a position, you do not have a position. You have a liquidity problem wearing a ticker.'),
        note('This is household order, not a product recommendation. The right sizes depend on your life, and this terminal does not know your life.'),
      ],
      quiz: [
        {
          prompt: 'Money promised to a near-term bill',
          choices: [
            'Belongs in a leveraged future, so it grows in time',
            'Does not belong in an instrument that can gap',
            'Should be the first thing you use to sell options',
            'Is safer in a single stock than in cash, because stocks rise',
          ],
          answer: 1,
          why: 'A known bill needs a known balance. A market position is not a known balance.',
        },
        {
          prompt: 'An emergency fund exists so that',
          choices: [
            'You can double a losing trade',
            'A shock does not force you to sell the long-term money on the worst day',
            'You can skip insurance',
            'The broker will raise your margin',
          ],
          answer: 1,
          why: 'The fund protects the rest of the plan from being sold at the worst time.',
        },
      ],
    },
    {
      slug: 'funds',
      title: 'Funds are the boring default',
      minutes: 6,
      blocks: [
        p('A mutual fund or an ETF pools many people\'s money and holds a portfolio. An index fund holds the recipe of an index and tries to match it, minus a fee. It will not beat the index. That is the product. The product is "do not try to be clever with money that has a job".'),
        h('What you pay'),
        p('You pay an expense ratio every year, quietly, out of the assets. A direct plan pays less than a regular plan because it does not include a distributor\'s commission. Over a decade the difference is not a rounding error. You also pay the market\'s own costs when the fund trades, and you pay tax when you sell, under whatever rules apply that year.'),
        h('What a fund is not'),
        p('It is not a savings account, and it is not a stock tip. An equity fund falls when equities fall. The reason to use one for the money you do not intend to trade is that a broad basket removes the risk of a single firm, which is the risk a stock page tempts you to take. Trade, if you trade, with the slice you have decided is a bet. Let the rest be boring on purpose.'),
        note('This terminal studies shares and rules. It is not a fund platform, and a lesson about funds is not an instruction to buy a particular scheme.'),
      ],
      quiz: [
        {
          prompt: 'An index fund is built to',
          choices: [
            'Beat the index by picking the best ten names',
            'Match the index, minus fees',
            'Hold only futures',
            'Guarantee the emergency fund',
          ],
          answer: 1,
          why: 'Matching is the mandate. The fee is why it will trail the index slightly in a fair comparison.',
        },
        {
          prompt: 'A direct plan usually costs less than a regular plan because',
          choices: [
            'It holds cash',
            'It does not include a distributor\'s commission',
            'The regulator waives tax',
            'It cannot fall',
          ],
          answer: 1,
          why: 'The regular plan\'s expense embeds distribution. Direct does not. The portfolio can still be the same kind of portfolio.',
        },
      ],
    },
    {
      slug: 'tax-shape',
      title: 'How gains get bucketed',
      minutes: 6,
      blocks: [
        p('India taxes different market activities differently. The labels move when the Finance Act moves. Learn the shape, then look up the current rates before you plan a real sale. This chapter is not tax advice, and it will not quote a rate that a later budget can change.'),
        h('The shape, for equities'),
        ul(
          'A holding-period line separates a short-term gain from a long-term one. Which side of the line a sale falls on changes the bucket.',
          'Listed equity and equity funds are not taxed like a salary, and they are not taxed like business income, unless you are in fact running a business of trading and your facts say so.',
          'Intraday cash trades and F&O are typically looked at as business income or speculative business income, with their own books, not as "capital gains on shares" in the casual sense.',
          'Securities transaction tax and other charges show up on the contract note. They are real costs even when they feel small next to a profit-and-loss screenshot.',
        ),
        p('Turnover, for a trader, is not the same word as profit. Filing rules look at turnover to decide audit and presumptive questions. If you trade derivatives seriously, a chartered accountant who has seen an F&O statement is cheaper than guessing. Bring them the contract notes, not a memory of the good month.'),
        note('Rates, exemptions, and what counts as turnover have changed before and will change again. The habit that survives is: know which bucket the trade is in, and check this year\'s law.'),
      ],
      quiz: [
        {
          prompt: 'This chapter refuses to quote a tax rate because',
          choices: [
            'Equity gains are untaxed',
            'The Finance Act changes the numbers, so a memorised rate becomes a confident mistake',
            'Only companies pay tax',
            'Paper trades are reported to the tax office by this website',
          ],
          answer: 1,
          why: 'The buckets are the lesson. The rates are a lookup, done in the year you actually sell.',
        },
        {
          prompt: 'Intraday and F&O profits are usually',
          choices: [
            'Ignored, because they net to zero',
            'In a different bucket from a long-term delivery holding, and they need their own records',
            'Taxed as a dividend',
            'Settled by the depository automatically',
          ],
          answer: 1,
          why: 'Activity changes the bucket. Delivery investing and a trading book are not the same return and not the same filing.',
        },
      ],
    },
    {
      slug: 'other-books',
      title: 'Currency, commodity, and bonds',
      minutes: 6,
      blocks: [
        p('Equity is one book. Currency, commodity, and government bonds are other books, with other clocks, other margins, and other reasons to be wrong. A skill in reading a stock chart does not transfer for free.'),
        h('Currency'),
        p('A currency future is a view on one unit of money priced in another. USDINR is rupees per dollar, not "the US market". The drivers are interest rates, flows, and policy, and the contract has its own lot and its own hours. A move that looks small in the pair is large on the margin, for the same reason a futures chapter already gave you.'),
        h('Commodity'),
        p('Commodities trade on their own exchange, with their own session, which is not the 9:15 to 15:30 cash session. Gold, crude, and the rest have supply stories — inventories, weather, a refinery — that an earnings model will not capture. The contract can also refer to a grade and a delivery point you have no intention of using. You are trading the contract, not a bar of metal in your cupboard.'),
        h('Government securities'),
        p('A bond pays a schedule of cash, and its price moves opposite to yields: when the yield the market demands goes up, the price of an existing bond goes down. That single sentence prevents the most common confusion. Government securities are not "safe" in the sense of a stable mark-to-market. They are free of private-company default in the way a government promise is, and they are full of interest-rate risk.'),
        note('Do not import an equity rule into these books unchanged. Learn the contract, the hours, and the thing that actually drives the price.'),
      ],
      quiz: [
        {
          prompt: 'USDINR is',
          choices: [
            'The Nifty, quoted in dollars',
            'A price for the dollar in rupees, with its own contract if you trade the future',
            'A commodity delivery on the NSE cash segment',
            'An expense ratio',
          ],
          answer: 1,
          why: 'It is a currency pair. The equity chart skills do not identify what moves it.',
        },
        {
          prompt: 'When the yield demanded on a bond rises',
          choices: [
            'The price of that existing bond rises too',
            'The price of that existing bond falls',
            'The bond becomes a share',
            'Margin on equity futures falls to zero',
          ],
          answer: 1,
          why: 'Price and yield move in opposite directions. A higher required yield is a lower price.',
        },
      ],
    },
    {
      slug: 'checklist',
      title: 'Before you size up',
      minutes: 5,
      blocks: [
        p('Sizing up means more rupees, not more indicators. Run the list when a paper record has made you restless. If a line fails, the size stays where it is.'),
        h('The list'),
        ul(
          'The money is money you can lose. The emergency fund still exists after you wire it.',
          'You can name the rule in four lines: entry, exit, size, filter.',
          'The record includes losers, costs, and at least one dull stretch. A single good month does not count as a record.',
          'You know the bucket: delivery, intraday, or derivative, and you know you will ask a tax professional before it is a real book.',
          'You know the contract: lot, expiry, margin, and what a gap can do to the stop.',
          'You have a day-ending loss after which you stop. It is written down.',
        ),
        p('If the list passes and you still want a real account, that account lives at a broker, under their rules. Nothing in this Learn section opens one, and nothing here will place the order when you get there.'),
        note('Education is the product of this section. A filled checklist is not a licence, and it is not advice to trade.'),
      ],
      quiz: [
        {
          prompt: 'A reason to keep the size unchanged is',
          choices: [
            'The last month was the best month',
            'The record has no dull stretch and no losers in it yet',
            'You learned the name of an indicator',
            'The emergency fund can be used as margin',
          ],
          answer: 1,
          why: 'A record that has not met boredom and loss has not met the strategy. Size waits.',
        },
        {
          prompt: 'Passing this checklist means',
          choices: [
            'This website will route live orders',
            'You have done the cheap thinking. A real account, if you open one, is still a separate decision at a broker',
            'You no longer need a risk sheet',
            'Tax no longer applies',
          ],
          answer: 1,
          why: 'The list is a gate you set for yourself. It does not connect this terminal to an exchange.',
        },
      ],
    },
  ],
};
