import type { Module } from '../types';
import { example, h, note, p, ul } from '../blocks';

export const options: Module = {
  slug: 'options',
  title: 'Options',
  blurb: 'A right you pay for, a duty someone else is paid to accept, and a clock that is part of the price.',
  level: 'Intermediate',
  chapters: [
    {
      slug: 'a-right',
      title: 'A right, not a duty',
      minutes: 6,
      blocks: [
        p('An option is a contract that gives the buyer a right, and leaves the seller with the duty if that right is used. The buyer pays a premium for the ability to walk away. The seller keeps the premium and cannot walk away.'),
        h('Calls and puts'),
        ul(
          'A call is the right to buy the underlying at the strike. You buy a call when you want the upside of a rise and you are willing to lose the premium if it never comes.',
          'A put is the right to sell at the strike. You buy a put when you want protection, or a view, against a fall, and you are willing to lose the premium if the fall never comes.',
        ),
        p('The seller of a call must sell at the strike if the buyer insists. The seller of a put must buy. On Indian exchanges these contracts are European-style: the right is exercised at expiry, not on a random Tuesday. Before expiry, people mostly close the contract by trading it, rather than exercising it. Index options are cash-settled. Stock options can be physically settled. Again, the contract spec is the source of truth.'),
        note('Buying an option caps the buyer\'s loss at the premium. Selling an option does not. The duty can cost far more than the premium collected. This module will not teach you to sell naked options as a habit.'),
      ],
      quiz: [
        {
          prompt: 'The buyer of a call',
          choices: [
            'Must buy the underlying at the strike',
            'Has the right to buy at the strike, and can let the right expire',
            'Collects the premium',
            'Has the duty to sell at the strike',
          ],
          answer: 1,
          why: 'The buyer holds the right. The seller holds the duty. The premium is the price of that split.',
        },
        {
          prompt: 'On a typical Indian exchange option, exercise happens',
          choices: [
            'Any day the buyer feels like it, American-style',
            'At expiry — the contracts are European-style — though the option can be sold before that',
            'Only if the company agrees',
            'Never, because options are only quotes',
          ],
          answer: 1,
          why: 'NSE equity and index options are European-style. You can still trade out of them any session before expiry.',
        },
      ],
    },
    {
      slug: 'payoff',
      title: 'What you keep if you are wrong',
      minutes: 6,
      blocks: [
        p('Draw the expiry payoff before you care about the entry tactic. At expiry the path is over and only the underlying price versus the strike remains, minus what you paid or plus what you received.'),
        h('The long call'),
        p('Below the strike, a call expires worthless and you lose the premium. Above the strike, the call is worth the gap between price and strike. You only come out ahead once that gap is larger than the premium you paid. Being "right" that the price would rise is not enough if it did not rise past the premium.'),
        h('The short call'),
        p('The picture is the mirror, and the mirror is unpleasant. You keep the premium if the price finishes below the strike. Above the strike your loss grows as the price rises, with no cap, while your gain was capped on day one. The same shape, flipped, applies to puts.'),
        example(
          'Right, and still behind',
          'Buy a 100-strike call for a premium of 4.',
          'At expiry the underlying is 103.',
          'The call is worth 3. You paid 4. You were directionally right and you lost money.',
          'You needed the underlying above 104 to break even.',
        ),
        note('These are expiry sketches. Before expiry the option is worth more than the sketch, because time and volatility still have a price. That is the next chapter.'),
      ],
      quiz: [
        {
          prompt: 'A long call at expiry finishes ahead only if',
          choices: [
            'The underlying is above the strike by any amount',
            'The underlying is above the strike by more than the premium you paid',
            'The underlying is unchanged',
            'Volume is high',
          ],
          answer: 1,
          why: 'The premium is a cost. The intrinsic value has to cover it.',
        },
        {
          prompt: 'The maximum gain of a short call is',
          choices: [
            'Unlimited',
            'The premium received',
            'The strike',
            'The margin',
          ],
          answer: 1,
          why: 'The seller\'s best case is that the option expires and they keep what they were paid. The loss is the side that is open-ended.',
        },
      ],
    },
    {
      slug: 'premium',
      title: 'Intrinsic value and time value',
      minutes: 6,
      blocks: [
        p('The premium you see in the market is two ideas added together. Intrinsic value is what the right would be worth if it expired this second. Time value is everything else people are willing to pay because it will not expire this second.'),
        h('Intrinsic'),
        p('For a call, intrinsic value is the greater of zero and (underlying minus strike). For a put, it is the greater of zero and (strike minus underlying). An option with intrinsic value is in the money. An option whose strike sits on the spot is at the money. An option with no intrinsic value is out of the money. Out of the money does not mean worthless before expiry. It means you are paying only for the chance that it gets there.'),
        h('Time value'),
        p('Time value is premium minus intrinsic value. It is the price of waiting: how long until expiry, how wildly the underlying moves, and how close the strike is to the action. You can be right about direction and still lose if you overpaid for waiting. You can also buy an option that looks "cheap" in rupees because it is far from the strike and far from likely.'),
        example(
          'Splitting a premium',
          'Underlying 100. Call strike 95. Premium 8.',
          'Intrinsic = 100 − 95 = 5.',
          'Time value = 8 − 5 = 3.',
          'Three rupees of the price is the clock and the uncertainty, not the money already in the strike.',
        ),
      ],
      quiz: [
        {
          prompt: 'Intrinsic value of a call is',
          choices: [
            'Always equal to the premium',
            'The greater of zero and underlying minus strike',
            'The greater of zero and strike minus underlying',
            'The margin on the future',
          ],
          answer: 1,
          why: 'A call is a right to buy. It has exercise value only when the underlying is above the strike.',
        },
        {
          prompt: 'Time value is',
          choices: [
            'Premium minus intrinsic value',
            'The brokerage',
            'Always zero for at-the-money options',
            'The lot size',
          ],
          answer: 0,
          why: 'Whatever is left in the premium after you remove the exercise value is what people are paying for the remaining life.',
        },
      ],
    },
    {
      slug: 'greeks',
      title: 'Delta, theta, and vega in plain language',
      minutes: 7,
      blocks: [
        p('The "Greeks" are partial derivatives of an option model. You do not need the calculus to know which risk each word is pointing at. They are sensitivities, not signals.'),
        h('Three that carry most conversations'),
        ul(
          'Delta is how much the premium tends to move when the underlying moves by one unit. A deep in-the-money call has a delta near 1. A far out-of-the-money call has a delta near 0. Delta also roughly describes, in the model, how often that option finishes in the money — roughly, not as a promise.',
          'Theta is how much premium the clock eats if nothing else changes. Long options pay theta. Short options collect it. "Nothing else changes" is the part that never happens, but the leak is real.',
          'Vega is how much the premium moves when the market\'s expected volatility moves. You can be right on direction and lose because the fear you paid for drained out of the price.',
        ),
        p('Gamma is the change in delta. It is why a position that felt small can become large as the underlying runs toward the strike near expiry. Near expiry, at the money, gamma and theta are both intense: the option is a coin flip with a short fuse.'),
        note('A model Greek is only as calm as the model. Gaps, circuits, and a volatility number that was wrong will not respect the delta you wrote down.'),
      ],
      quiz: [
        {
          prompt: 'Theta, for someone who bought an option, is',
          choices: [
            'A credit, if the underlying is quiet',
            'The premium lost to the passage of time when other inputs stay put',
            'The same thing as the dividend',
            'Always zero until expiry day',
          ],
          answer: 1,
          why: 'Long options rent the right. The rent is theta. Quiet markets do not refund it.',
        },
        {
          prompt: 'Vega is the sensitivity of the premium to',
          choices: [
            'The passage of a calendar day',
            'A change in expected volatility',
            'The brokerage slab',
            'The lot size alone',
          ],
          answer: 1,
          why: 'Direction is delta. The clock is theta. The price of uncertainty is vega.',
        },
      ],
    },
    {
      slug: 'expiry',
      title: 'The clock is the product',
      minutes: 5,
      blocks: [
        p('A share has no expiry. An option is a share of a view that dies on a date. Most of the surprise in an option account is people treating the second thing as the first.'),
        h('Why long options often expire worthless'),
        p('Many listed strikes are out of the money. They are cheap in rupees because they are unlikely. Buying them because the premium "is only a few rupees" ignores that the few rupees are the entire premium, and the probability is already inside the price. Sellers, in aggregate, are paid to hold the duty that those cheap rights expire. That does not make selling safe. It means the buyer should know they are buying a low probability, not a bargain.'),
        h('Expiry week is a different instrument'),
        p('As the clock runs out, time value collapses and gamma rises. A strike that was a sleepy quote on Monday can swing in rupees on Thursday afternoon for a move that would barely show on the share. If your plan was "a view on the company over a year", a weekly option is the wrong container. Match the container to the horizon.'),
        note('You do not have to trade expiry week. Most of the damage people describe as "the market" is a horizon mismatch they chose.'),
      ],
      quiz: [
        {
          prompt: 'A far out-of-the-money option is cheap in rupees because',
          choices: [
            'The exchange subsidises it',
            'The chance it finishes in the money is small, and the price reflects that',
            'Theta is zero that far away',
            'It includes the underlying share',
          ],
          answer: 1,
          why: 'A small premium is often a small probability, not a pricing error.',
        },
        {
          prompt: 'A one-year view packed into an option that dies this Thursday',
          choices: [
            'Is efficient, because short options are always cheaper',
            'Is a different bet: you now need the move to happen before the clock, not eventually',
            'Removes theta',
            'Is the same payoff as holding the share',
          ],
          answer: 1,
          why: 'The expiry is part of the thesis. A view that needs a year cannot be hosted by a contract that ends on Thursday.',
        },
      ],
    },
    {
      slug: 'defined-risk',
      title: 'Defined risk is a structure, not a mood',
      minutes: 6,
      blocks: [
        p('If you want a view and you also want a loss that is known on the day you enter, you have to buy that property. A long option has it: the premium. A spread has it, with a smaller premium and a capped gain. A naked short option does not have it.'),
        h('One structure, so the shape is clear'),
        p('A call spread: buy a call at a lower strike, sell a call at a higher strike, same expiry. You pay a net debit. If the underlying finishes below both strikes, both expire and you lose the debit — that is the most you can lose. If it finishes above both, the long call\'s gain is offset by the short call\'s loss beyond the higher strike, so the most you can make is the distance between the strikes, minus the debit. You sold away the unlimited upside to reduce what the view cost.'),
        h('Complexity is not skill'),
        p('Adding legs adds commissions, wider spreads, a harder exit, and more ways to be wrong about volatility while being right about direction. A structure you cannot sketch from memory is a structure you will mismanage when it moves. Learn the long option until the payoff is boring. Then learn one spread. Then stop collecting names.'),
        example(
          'The cap you sold',
          'Buy the 100-call, sell the 110-call, net debit 3.',
          'Worst case: both expire, loss 3.',
          'Best case: underlying at or above 110, value of the spread is 10, profit 7.',
          'Above 110 you make nothing more. That was the sale.',
        ),
        note('This is a shape, not a recommendation of strikes, size, or timing. Paper it before you fund it, and do not paper it at a size your real account could not survive.'),
      ],
      quiz: [
        {
          prompt: 'In a call debit spread, the maximum loss is',
          choices: [
            'Unlimited',
            'The net premium paid',
            'The higher strike',
            'The margin on a future',
          ],
          answer: 1,
          why: 'You paid a debit for a structure whose worst expiry is both options dying. That debit is the defined loss.',
        },
        {
          prompt: 'The short call in that spread',
          choices: [
            'Removes the cap on your gain',
            'Pays for part of the long call, and caps your gain at the higher strike',
            'Turns the position into a hedge of shares you must already own',
            'Eliminates the need for an expiry',
          ],
          answer: 1,
          why: 'You sold the upside beyond the higher strike. The credit you received is why the view costs less than the naked long call.',
        },
      ],
    },
  ],
};
