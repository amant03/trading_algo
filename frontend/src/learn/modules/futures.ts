import type { Module } from '../types';
import { example, h, note, p, ul } from '../blocks';

export const futures: Module = {
  slug: 'futures',
  title: 'Futures',
  blurb: 'A contract with a clock on it: lots, margin, daily settlement, and the difference between hedging and leverage.',
  level: 'Intermediate',
  chapters: [
    {
      slug: 'a-promise',
      title: 'A future is a promise with a date',
      minutes: 6,
      blocks: [
        p('A futures contract is an agreement to trade a fixed quantity of something at a fixed price on a fixed date. You do not need to hold it until that date. You can close it by taking the opposite contract. Until you do, the promise is alive.'),
        h('The lot is the unit'),
        p('You do not buy "one share" of a future. You buy a lot: a contract size the exchange sets, and revises. The notional is lot size times price. A future on a share trading at ₹1,000 with a lot of 500 shares is a ₹5 lakh promise, even if the margin you post is much smaller. People talk about the margin because that is the cash that leaves their account. The risk lives in the notional.'),
        h('Expiry is not a suggestion'),
        p('Each contract has an expiry. At expiry, index futures in India are typically cash-settled: the difference versus the final settlement price is paid, and the contract dies. Stock futures may be physically settled, which means the shares and the cash actually move if you are still holding. The contract specification is the authority. A module can go stale; the spec cannot be argued with.'),
        note('Lot sizes and settlement style change. Before you size anything, read the current contract, not a blog\'s memory of it.'),
      ],
      quiz: [
        {
          prompt: 'The economically relevant size of a futures position is',
          choices: [
            'The margin you posted',
            'The notional: price times the lot',
            'The brokerage',
            'Yesterday\'s volume',
          ],
          answer: 1,
          why: 'Margin is the deposit. Gains and losses are computed on the full notional.',
        },
        {
          prompt: 'You can exit a future before expiry by',
          choices: [
            'Waiting for the company to delist',
            'Entering the opposite contract and netting the position off',
            'Converting it into a mutual fund',
            'Asking the depository to cancel the lot',
          ],
          answer: 1,
          why: 'An offsetting trade closes the promise. You do not have to reach the expiry date.',
        },
      ],
    },
    {
      slug: 'margin',
      title: 'Margin is a deposit, not a discount',
      minutes: 6,
      blocks: [
        p('Margin is the cash the clearing corporation requires so that yesterday\'s loss can be paid this morning. It is not a sale price. You have not bought the underlying for the margin. You have posted collateral against a larger promise.'),
        h('Leverage is the ratio'),
        p('If the notional is ₹5 lakh and the margin is ₹1 lakh, you control ₹5 of exposure with ₹1 of cash. A 2% move in the underlying is ₹10,000, which is 10% of the margin. The underlying did not become more volatile. Your account did, because you posted a fraction of the risk.'),
        h('Two margins, roughly'),
        ul(
          'Initial margin is what you need to open the position. It is built to cover a bad day, not a bad month.',
          'As the position moves against you, mark-to-market takes cash daily. If cash runs out, you are asked for more. If you cannot post it, the position can be closed for you.',
        ),
        example(
          'The same 2% move',
          'Notional ₹5,00,000. Margin posted ₹1,00,000.',
          'Underlying falls 2%: loss ₹10,000.',
          'That is 2% of the thing you track, and 10% of the cash you posted.',
          'Five such days, without fresh cash, and the deposit is gone. The notional is not.',
        ),
        note('This paper terminal does not reproduce span margin or a broker\'s square-off rules. Do not learn leverage from a fill that only charged slippage.'),
      ],
      quiz: [
        {
          prompt: 'Posting ₹1 lakh of margin on a ₹5 lakh notional means',
          choices: [
            'Your maximum loss is ₹1 lakh, by exchange rule, in every case',
            'A small percentage move in the underlying is a large percentage move in your cash',
            'You own the shares outright',
            'The position cannot be closed before expiry',
          ],
          answer: 1,
          why: 'Leverage scales the percentage result. Losses can exceed the original margin if you keep the position and keep posting, or if a gap outruns the deposit.',
        },
        {
          prompt: 'Initial margin is designed to',
          choices: [
            'Be the full notional, so there is no leverage',
            'Cover a large adverse move so the clearing house gets paid',
            'Equal the brokerage',
            'Replace mark-to-market',
          ],
          answer: 1,
          why: 'It is a risk deposit sized for a bad day. Daily settlement then collects the actual loss.',
        },
      ],
    },
    {
      slug: 'mark-to-market',
      title: 'You settle every day',
      minutes: 5,
      blocks: [
        p('Futures are marked to the day\'s settlement price. If the contract moved in your favour, cash is credited. If it moved against you, cash is debited. You do not wait for expiry to discover the result. Your account already knows.'),
        h('Why that changes behaviour'),
        p('A cash share can fall 30% and, if you do not use margin, nobody calls you. You are merely poorer on paper, and you can wait. A future that falls hands the loss over in cash. If the cash is not there, the position ends whether your thesis has or not. The instrument selects for people who can fund the path, not only the destination.'),
        p('This is also why "it will come back by expiry" is not a plan. The path is settled daily. A thesis that is right in three weeks and intolerable in three days is a thesis your margin cannot hold.'),
        note('Mark-to-market is a feature. It stops losses hiding inside a contract until expiry. It also means a temporary gap can evict you.'),
      ],
      quiz: [
        {
          prompt: 'Mark-to-market means',
          choices: [
            'Losses are only calculated at expiry',
            'The day\'s gain or loss is credited or debited in cash',
            'The lot size changes every evening',
            'The underlying share is delivered every night',
          ],
          answer: 1,
          why: 'Daily settlement turns the price change into cash, not into a number you can ignore.',
        },
        {
          prompt: 'A futures thesis that needs three quiet weeks',
          choices: [
            'Is safe as long as you are right at expiry',
            'Can still fail if the daily cash losses arrive before the thesis does',
            'Does not require margin',
            'Is the same as holding the share in a demat account',
          ],
          answer: 1,
          why: 'The path is funded daily. Being right later does not refund a square-off that happened earlier.',
        },
      ],
    },
    {
      slug: 'basis',
      title: 'Basis and the roll',
      minutes: 6,
      blocks: [
        p('The futures price and the spot price are not required to be equal until expiry. The gap is the basis. Before expiry, the future can sit above the spot (the usual case when holding the asset has a cost) or below it (when holders are paid, or are desperate, to keep the asset).'),
        h('Why they meet at the end'),
        p('At expiry the contract becomes the asset, or the cash difference versus the asset. A large gap on the last day would be free money for anyone allowed to trade both sides, so the gap is pulled shut. Before that day, the gap is the cost of time, dividends, and how badly people want the exposure without holding the asset.'),
        h('Rolling'),
        p('If you want the exposure to outlive the contract, you close the near contract and open the next one. That trade is the roll. You pay the difference in price between the two contracts, and you pay the spread twice. A strategy that looks smooth on a stitched "continuous" chart has often hidden the roll. The continuous chart is a fiction built so the picture does not jump. Your account is not a fiction. It pays the jump.'),
        example(
          'A roll is a real trade',
          'Near future: 100. Next future: 101.',
          'You sell the near and buy the next.',
          'You are still "long the market". You are also long a new contract, at a new price, after two more crossings of the spread.',
        ),
      ],
      quiz: [
        {
          prompt: 'Basis is',
          choices: [
            'The brokerage on a futures trade',
            'The gap between the futures price and the spot price',
            'The initial margin',
            'The lot size',
          ],
          answer: 1,
          why: 'Futures minus spot. It is not required to be zero until the contract converges at expiry.',
        },
        {
          prompt: 'A continuous futures chart',
          choices: [
            'Is the contract you can actually hold for five years',
            'Is a stitched picture. Rolling into the real next contract is a separate trade with its own cost',
            'Removes the need for margin',
            'Is published by the company',
          ],
          answer: 1,
          why: 'The stitch hides the roll. The account does not.',
        },
      ],
    },
    {
      slug: 'hedging',
      title: 'A hedge reduces a risk you already have',
      minutes: 6,
      blocks: [
        p('Leverage uses a future to take a risk you did not have. A hedge uses a future to shrink a risk you already have. The contract is the same. The position it sits against is the whole difference.'),
        h('The long stock, the short future'),
        p('Suppose you own shares and you do not want to sell them — tax, a lock-in, a view that the business is fine but the next month is not. Selling a future against those shares means a fall in the share is roughly offset by a gain on the future, and a rise in the share is roughly offset by a loss on the future. You have not created safety for free. You have swapped "I am exposed to the price" for "I am exposed to the basis, the roll, and the chance I sized the hedge badly".'),
        h('A hedge that is larger than the risk'),
        p('If the short future is bigger than the shares you hold, the extra is not a hedge. It is a short position wearing a hedge\'s name. Write the exposure in rupees of notional on both sides before you call it protection.'),
        ul(
          'Match the thing you hold to the thing the contract refers to. A different stock is a partial hedge and a new bet.',
          'Match the horizon. A one-week fear does not need a contract you must roll for a year.',
          'Know what you still have: basis, rolls, and a contract that expires.',
        ),
        note('Hedging is a reduction of one risk in exchange for others. It is not a reward, and it is not required study before you are allowed to own a share outright.'),
      ],
      quiz: [
        {
          prompt: 'Shorting a future against shares you already own',
          choices: [
            'Increases your exposure to the share price',
            'Offsets a good deal of the share-price move, and leaves you with basis and sizing risk',
            'Cancels the tax on the shares',
            'Is free, because the future is only a hedge',
          ],
          answer: 1,
          why: 'The price risk shrinks. The basis, the roll, and a mismatched size do not.',
        },
        {
          prompt: 'A hedge larger than the position it protects',
          choices: [
            'Is safer, because more protection is always better',
            'Contains a speculative position in the extra size',
            'Has zero margin',
            'Becomes an option automatically',
          ],
          answer: 1,
          why: 'Protection stops where the original exposure stops. Size beyond that is a new bet.',
        },
      ],
    },
  ],
};
