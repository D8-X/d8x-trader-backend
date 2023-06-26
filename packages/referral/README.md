# Referral System

# API

### get: `http://localhost:8889/my-referral-codes?addr=0x9d5aab428e98678d0e645ea4aebd25f744341a05`

_Description_: get current referrer codes for an address. Returns all information the system can find:

- If the address belongs to a trader with a registered code, it returns their code
- If the address belongs to a referrer with a registered code, it returns their code
- If the address belongs to an agency with a registered code, it returns their code

_Response_: Example with all fields filled

```
{
"type":"my-referral-codes",
"msg":"",
"data":{
    "trader":{
    "code":"REBATE100",
    "activeSince":"2023-06-26T17:49:21.413Z"
    },
    "referrer":[
    {
        "code":"REBATE_REF",
        "referrerAddr":"0x9d5aaB428e98678d0E645ea4AeBd25f744341a05",
        "agencyAddr":"",
        "brokerAddr":"0x5A09217F6D36E73eE5495b430e889f8c57876Ef3",
        "traderRebatePerc":10,
        "agencyRebatePerc":80,
        "referrerRebatePerc":10,
        "createdOn":"2023-06-26T17:47:25.417Z",
        "expiry":"2042-04-24T02:42:42.000Z"
    }
    ],
    "agency":[
        {
            "code":"REBATE100",
            "referrerAddr":"0x863AD9Ce46acF07fD9390147B619893461036194",
            "agencyAddr":"0x9d5aaB428e98678d0E645ea4AeBd25f744341a05",
            "brokerAddr":"0x5A09217F6D36E73eE5495b430e889f8c57876Ef3",
            "traderRebatePerc":10,
            "agencyRebatePerc":80,
            "referrerRebatePerc":10,
            "createdOn":"2023-06-26T17:45:38.646Z",
            "expiry":"2042-04-24T02:42:42.000Z"
        }]
    }
}
```

### get: `http://localhost:8889/agency-rebate`

_Description_: get the cut that the agency gets from the broker fee income. This cut is split between agency, referrer, and trader

_Response_: `{"type":"agency-rebate","msg":"","data":{"percentageCut":80}}`

### get `http://localhost:8889/referral-rebate?referrerAddr=0x9d5aaB428e98678d0E645ea4AeBd25f744341a05`

_Description_: get the cut that the referrer gets from the broker fee income. This cut is split between referrer and trader.
The size of the cut can be defined based on a token holding of the referrer. Referrer has to own the token before
querying this endpoint otherwise they have to wait a long time for the holdings to be updated.

_Response_: `{"type":"referral-rebate","msg":"","data":{"percentageCut":3.5}}`

### post: `/select-referral-code`

_Description_: as a trader selects a referral code to trade with going forward. Will overwrite trader's existing code if any exists.

```
let mycodeselection: APIReferralCodeSelectionPayload = {
    code: "REBATE100",
    traderAddr: address,
    createdOn: 1687716653,
    signature: "", //<- signature needed
  };
```

Trader signs (see test/referral.test.ts testSelectCode)

_Response_: `{"type":"select-referral-code","msg":"","data":{"code": "REFERRAL42"}}`

### post: `/create-referral-code`

_Description_: create a new referral code as agency or as referrer without agency

#### Agency:

```
let mynewcode: APIReferralCodePayload = {
    code: "REBATE100",
    referrerAddr: "0x863AD9Ce46acF07fD9390147B619893461036194",
    agencyAddr: "0x9d5aaB428e98678d0E645ea4AeBd25f744341a05",
    createdOn: 1687716653,
    traderRebatePerc: 10,
    agencyRebatePerc: 45,
    referrerRebatePerc: 45,
    signature: "", //<-agency addr must sign
  };
```

Agency signs (see test/referral.test.ts testCreateCodeFromAgency)

#### Referrer only:

let mycodeselection: APIReferralCodeSelectionPayload = {
code: "REBATE100",
traderAddr: address,
createdOn: 1687716653,
signature: "",
};

```
 let mynewcode: APIReferralCodePayload = {
    code: "REBATE_REF",
    referrerAddr: "0x9d5aaB428e98678d0E645ea4AeBd25f744341a05",
    agencyAddr: "", //<-- must be empty string
    createdOn: 1687716653,
    traderRebatePerc: 10,
    agencyRebatePerc: 0, //<-- must be zero without agency
    referrerRebatePerc: 90,
    signature: "", // referrer addr must sign
  };
```

Referrer signs (see test/referral.test.ts testCreateCodeFromReferrer)

_Response_: `{"type":"create-referral-code","msg":"","data":{"code": "REFERRAL42"}}`

## DEV

### Testing Codes

INSERT INTO referral_code (code, referrer_addr, broker_addr, broker_payout_addr, trader_rebate_perc, referrer_rebate_perc)
VALUES ('CASPAR', '0x863AD9Ce46acF07fD9390147B619893461036194', '0x9d5aaB428e98678d0E645ea4AeBd25f744341a05', '0x0aB6527027EcFF1144dEc3d78154fce309ac838c', 10, 50);

INSERT INTO referral_code (code, referrer_addr, broker_addr, broker_payout_addr, trader_rebate_perc, referrer_rebate_perc)
VALUES ('MARCO', '0x21B864083eedF1a4279dA1a9A7B1321E6102fD39', '0x9d5aaB428e98678d0E645ea4AeBd25f744341a05', '0x0aB6527027EcFF1144dEc3d78154fce309ac838c', 15, 60);

INSERT INTO referral_code (code, referrer_addr, broker_addr, broker_payout_addr, trader_rebate_perc, referrer_rebate_perc, expiry)
VALUES ('EXPIRED', '0x21B864083eedF1a4279dA1a9A7B1321E6102fD39', '0x9d5aaB428e98678d0E645ea4AeBd25f744341a05', '0x0aB6527027EcFF1144dEc3d78154fce309ac838c', 15, 60, '2023-04-13 12:10:00+00:00');

INSERT INTO referral_code (code, referrer_addr, broker_addr, broker_payout_addr, trader_rebate_perc, referrer_rebate_perc)
VALUES ('DEFAULT', '0x21B864083eedF1a4279dA1a9A7B1321E6102fD39', '0x9d5aaB428e98678d0E645ea4AeBd25f744341a05', '0x0aB6527027EcFF1144dEc3d78154fce309ac838c', 15, 60);

INSERT INTO referral_code_usage (trader_addr, code)
VALUES ('0x6fe871703eb23771c4016eb62140367944e8edfc', 'CASPAR');

INSERT INTO referral_code_usage (trader_addr, code)
VALUES ('0x9d5aaB428e98678d0E645ea4AeBd25f744341a05', 'CASPAR');
