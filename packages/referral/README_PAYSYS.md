# Payment System

There are two types of referral system. One involving an agency that works with Key Opinion Leaders to refer traders, and one involving no agency.

## Agency Model

Brokers can whitelist agencies (config/live.referralSettings.json) and they assign a "cut percent" (agencyCutPercent in the same config). The cut percent is the relative
amount of fees that the broker assigns for the agencies to be used.
For example, with 80% cut, the agency gets 80% of the trading fees of traders using
their code. This 80% cut is further split between agency, referrer, and trader
and determined by the agency.

To summarize, the rebates are distributed as follows:

- trader-rebate = FEE_EARNINGS \* agencyCutPercent/100 \* trader_rebate_perc/100
- referrer-rebate = FEE_EARNINGS \* agencyCutPercent/100 \* referrer_rebate_perc/100
- agency-rebate = FEE_EARNINGS \* agencyCutPercent/100 \* agency_rebate_perc/100
- the broker keeps the remainder

where trader_rebate_perc + referrer_rebate_perc + agency_rebate_perc = 100

## Referral Model without Agency

Anyone can become a referrer and earn from trades executed with this referral code.
The "cut percent" is determined by the broker (config/live.referralSettings.json,
referrerCutPercentForTokenXHolding) and can be configured so that the referrer gets
a higher cut, the more of a specified token they own.

To summarize, the rebates are distributed as follows:

- referrerCutPerc := f(tokenholdings as defined in settings)
- trader\*rebate_cc = FEE_EARNINGS \* referrerCutPerc/100 \* trader_rebate_perc/100
- the broker keeps the remainder

where trader_rebate_perc + referrer_rebate_perc = 100, agency_rebate_perc = 0

# Operations

The payment system uses a contract [MultiPay.sol](https://github.com/D8-X/referral-payment)
Multipay emits the following event

```
event Payment(
        address indexed from,
        uint32 indexed id,
        address indexed token,
        uint256[] amounts,
        address[] payees,
        string message
    );

```

Payments are performed per trader-address.
The system at hand encodes the payment information so that the resulting event contains the following information:

- `from`: the paying wallet address, i.e., the broker address that collected trading fees
- `id`: timestamp in seconds of the last trade considered for this payment
- `token`: payment token
- `amounts`: array of amounts in the corresponding order of payees, can be 0; number in decimal convention of the token
- `payees`: addresses of the payees in the following "TRAB" order: Trader, Referrer, Agency, Broker. Can contain zero addresses
- `message`: a string consisting of "timestamp-batch"."referral-code"."pool-id", for example 1689791401.REBATE500.1, where
  - timestamp-batch: is the timestamp when the weekly (or as defined) payment execution for all traders was started
  - referral-code: the referral code used by the trader, or DEFAULT, if none was used but a default payment was configured
  - pool-id: the pool-id of the perpetual being paid (liquidity pools are numbered from 1 to n)
