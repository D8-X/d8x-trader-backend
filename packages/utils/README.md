# `utils`

> TODO: description

## Usage

```
const utils = require('utils');

// TODO: DEMONSTRATE API
```

## DEV

### Change DB schema

##apply migration
```
source .env
export DATABASE_DSN_HISTORY=$DATABASE_DSN
npx prisma migrate deploy --schema="./packages/utils/prisma/schema.prisma"
```

## new migration


`export DATABASE_DSN_REFERRAL=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}?schema=public`

`npx prisma migrate dev --schema="./packages/utils/prisma/schema.prisma" --name="yourchoice"`

## reset
Reset if migration out of sync: `npx prisma migrate reset --schema="./packages/utils/prisma/schema.prisma"`

INSERT INTO referral_code (code, referrer_addr, broker_addr, broker_payout_addr, trader_rebate_perc, referrer_rebate_perc)
VALUES ('CASPAR', '0x863AD9Ce46acF07fD9390147B619893461036194', '0x9d5aaB428e98678d0E645ea4AeBd25f744341a05', '0x0aB6527027EcFF1144dEc3d78154fce309ac838c', 10, 50);

INSERT INTO referral_code (code, referrer_addr, broker_addr, broker_payout_addr, trader_rebate_perc, referrer_rebate_perc)
VALUES ('MARCO', '0x21B864083eedF1a4279dA1a9A7B1321E6102fD39', '0x9d5aaB428e98678d0E645ea4AeBd25f744341a05', '0x0aB6527027EcFF1144dEc3d78154fce309ac838c', 15, 60);

INSERT INTO referral_code (code, referrer_addr, broker_addr, broker_payout_addr, trader_rebate_perc, referrer_rebate_perc)
VALUES ('DEFAULT', '0x21B864083eedF1a4279dA1a9A7B1321E6102fD39', '0x9d5aaB428e98678d0E645ea4AeBd25f744341a05', '0x0aB6527027EcFF1144dEc3d78154fce309ac838c', 15, 60);
