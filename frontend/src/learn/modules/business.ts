import type { Module } from '../types';
import { example, h, note, p, ul } from '../blocks';

export const business: Module = {
  slug: 'business',
  title: 'Fundamental analysis',
  blurb: 'The business behind the ticker: what a share is a claim on, how the three statements fit, and why a single "fair price" is a story.',
  level: 'Intermediate',
  chapters: [
    {
      slug: 'a-share-is-a-claim',
      title: 'What you own',
      minutes: 5,
      blocks: [
        p('A share is a residual claim. If the company pays its people, its suppliers, its lenders, and its taxes, and anything is left, the owners have a claim on what remains — either as cash paid out, or as cash reinvested in a business you still own.'),
        h('Price and claim are different objects'),
        p('The market price is today\'s auction for that claim. The claim itself is the business: customers, costs, assets, and the people running it. They can diverge for a long time. A wonderful business can be a bad purchase at a price that already assumes perfection. A mediocre business can be a fine purchase at a price that assumes ruin.'),
        p('Dividends are not a wage. The board can cut them. Buybacks can stop. Your return, if you hold, is whatever cash eventually comes back to you plus whatever someone later pays you for the claim. If you do not hold, your return is only the second part, and you are trading the auction, not underwriting the business.'),
        note('Nothing in a ratio forces the auction to agree with you. Being right about the business and early about the price feels, for a long time, exactly like being wrong.'),
      ],
      quiz: [
        {
          prompt: 'A share is a residual claim because owners are paid',
          choices: [
            'Before employees and lenders',
            'After the obligations ahead of them have been met',
            'A fixed coupon every quarter',
            'By the exchange, from brokerage',
          ],
          answer: 1,
          why: 'Equity stands behind wages, suppliers, debt, and tax. What is left is the residual.',
        },
        {
          prompt: 'A great business is',
          choices: [
            'Always a great purchase, at any price',
            'A great purchase only at a price that does not already assume the good news',
            'Required to rise every year',
            'Unable to cut its dividend',
          ],
          answer: 1,
          why: 'The claim and the auction are different. The price can already contain the quality.',
        },
      ],
    },
    {
      slug: 'three-statements',
      title: 'Earnings, assets, and cash',
      minutes: 7,
      blocks: [
        p('Three statements describe the same firm from three sides. You do not need to become an accountant to see how they argue with each other.'),
        h('Income statement'),
        p('Revenue, then the costs of getting it, then what is left. Profit is an opinion that follows accounting rules: when revenue is recognised, how a machine is depreciated, what is called a one-time cost. A single year\'s profit is a paragraph, not a biography.'),
        h('Balance sheet'),
        p('What the firm owns, what it owes, and the difference, which is equity. Debt is not evil. Debt that must be refinanced just as profits vanish is how equity gets wiped out. Look at the size of the debt against the cash the business produces, not against a slogan.'),
        h('Cash flow'),
        p('Profit is not cash. A firm can report earnings while cash leaves to fund inventory, receivables, or a plant. The cash flow statement is where that gap shows up. Over many years, a business that never turns profit into cash is asking you to fund the gap.'),
        example(
          'Profit without cash',
          'Reported profit: ₹100',
          'Customers have not paid yet: receivables up ₹80',
          'Cash from operations is closer to ₹20',
          'The income statement told a happier story than the bank account.',
        ),
        note('Annual reports and filings are the source. A ratio on a terminal is a compression of a filing, and compressions go stale or get restated.'),
      ],
      quiz: [
        {
          prompt: 'Profit and cash differ because',
          choices: [
            'Cash ignores revenue',
            'Accounting can recognise profit before the cash arrives, or after cash has already left',
            'The exchange converts profit into cash at the close',
            'Only dividends count as profit',
          ],
          answer: 1,
          why: 'Timing. Receivables, inventory, capex, and accruals sit between the two numbers.',
        },
        {
          prompt: 'The balance sheet\'s equity figure is',
          choices: [
            'Today\'s market capitalisation',
            'Assets minus liabilities, on the accounting rules in force',
            'The dividend to be paid next quarter',
            'The promoter\'s pledge',
          ],
          answer: 1,
          why: 'Book equity is an accounting residual. The market cap is the auction\'s price for the same firm.',
        },
      ],
    },
    {
      slug: 'ratios',
      title: 'The ratios on a stock page',
      minutes: 6,
      blocks: [
        p('A ratio is a division that makes two firms, or two years, comparable. It also hides whatever you did not put in the division. Read the name before you read the grade.'),
        h('A few that actually travel'),
        ul(
          'P/E puts the auction next to a year of earnings. A low P/E can mean cheap, or it can mean earnings that are about to fall.',
          'ROE puts profit next to book equity. A high ROE can mean a wonderful business, or a tiny equity base propped up by debt.',
          'Debt to equity puts obligations next to that same book equity. Compare it with the cash the business can spare, not with a universal "good" number.',
        ),
        p('Any of these can be distorted by a one-time gain, a change in share count, or a sector that simply lives with different margins. A bank and a software firm do not share a sensible P/E range. The ratio did not fail. The comparison did.'),
        note('Key ratios on a stock page are a starting list, computed from the fundamentals feed. If a figure looks impossible, suspect a stale filing or a one-off, and read the source before you trade it.'),
      ],
      quiz: [
        {
          prompt: 'A low P/E means',
          choices: [
            'The share is on sale, by definition',
            'The price is low relative to a stated year of earnings — which may be about to change',
            'The firm has no debt',
            'Return on equity is high',
          ],
          answer: 1,
          why: 'P/E is a ratio of two moving parts. Cheapness is a conclusion you still have to earn.',
        },
        {
          prompt: 'Comparing a bank\'s P/E with a software firm\'s P/E is weak because',
          choices: [
            'Ratios cannot be computed for banks',
            'The businesses convert revenue into profit, and into risk, in different ways',
            'Software firms are not allowed to list',
            'P/E only works on the Nifty 50',
          ],
          answer: 1,
          why: 'A ratio is comparable inside a similar economic model. Across models it mostly measures the model.',
        },
      ],
    },
    {
      slug: 'peers',
      title: 'Compare like with like',
      minutes: 5,
      blocks: [
        p('A sector is a label for firms that sell into similar demand and suffer similar costs. The label is rough. Two "IT" firms can have different clients, different geographies, and different accounting for the same word "revenue".'),
        h('What a peer set is for'),
        p('Peers stop you grading a firm against the whole market. A commodity producer should look expensive on a year of peak earnings and cheap on a year of trough earnings. That cycle is the business. A peer set shows whether this firm is the expensive one inside the cycle, or whether the whole group has been re-rated.'),
        h('What a peer set is not'),
        p('It is not a list of substitutes you can swap without reading. The cheapest name in a dying industry is not a bargain. The dearest name in a group can be the only one with a balance sheet that survives a bad year. Use peers to find the question — why is this one different? — and then answer it from the filings, not from the sort order.'),
        note('Peer and sector panels on this terminal are a map. A map is allowed to be slightly wrong and still useful. Do not treat the grouping as the analysis.'),
      ],
      quiz: [
        {
          prompt: 'A peer comparison is useful when it',
          choices: [
            'Replaces reading the annual report',
            'Shows whether a valuation gap is this firm or the whole group',
            'Picks the lowest P/E automatically',
            'Ignores balance sheets',
          ],
          answer: 1,
          why: 'The set separates "the sector moved" from "this name is the outlier". The outlier still needs an explanation.',
        },
        {
          prompt: 'The cheapest stock in a peer group',
          choices: [
            'Is the best buy',
            'Might be cheap because the business is worse, the cycle is worse, or the accounting is worse',
            'Must have the highest ROE',
            'Is the index',
          ],
          answer: 1,
          why: 'Price is a clue. The reason for the price is the work.',
        },
      ],
    },
    {
      slug: 'value-is-a-range',
      title: 'A fair price is a range',
      minutes: 6,
      blocks: [
        p('Every valuation model is a small machine that turns assumptions into a number. Change the assumptions and the number moves. If someone quotes a fair value to the rupee, they have hidden the assumptions, not eliminated them.'),
        h('The machine, briefly'),
        p('One common machine discounts the cash the business might produce. It needs a growth rate, a margin, a life for that growth, and a rate that says what you demand for waiting and for being wrong. None of those are on the balance sheet. They are judgments. A range — run the machine at a pessimistic set and an optimistic set — is the honest output. A single target is the midpoint someone chose to publish.'),
        h('What you do with a range'),
        ul(
          'If the auction is far above even your optimistic case, you are paying for a story you do not believe.',
          'If the auction is below your pessimistic case, you may be early, wrong, or both. The gap is not a timer.',
          'If your range is so wide that any price fits, you do not understand the business yet. That is a useful result.',
        ),
        example(
          'Same firm, two rates',
          'Cash flows unchanged.',
          'Demand 10% for waiting: the claim looks reasonably priced.',
          'Demand 14% because you think the debt is fragile: the same claim looks expensive.',
          'The firm did not change. Your required return did.',
        ),
        note('Models are not oracles, and this terminal does not compute a fair value for you. The ratios are inputs to a judgment, not the judgment.'),
      ],
      quiz: [
        {
          prompt: 'A precise fair-value target usually means',
          choices: [
            'The uncertainty has been removed',
            'The assumptions have been fixed, not revealed',
            'The exchange will converge to that price',
            'The model uses no discount rate',
          ],
          answer: 1,
          why: 'Precision is a choice of inputs. A range shows how the output moves when the inputs move.',
        },
        {
          prompt: 'If every reasonable assumption still fits today\'s price',
          choices: [
            'The model has proved the share is fairly priced and safe',
            'The range is too wide to decide, which means you need a sharper view or a smaller bet',
            'You should buy because the model cannot reject the price',
            'RSI will be 50',
          ],
          answer: 1,
          why: 'A valuation that cannot say no is not evidence. It is an unfinished model.',
        },
      ],
    },
  ],
};
