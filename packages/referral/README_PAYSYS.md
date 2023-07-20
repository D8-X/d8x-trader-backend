# Payment System

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
