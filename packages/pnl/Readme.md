# Profit and loss service

This directory contains the PnL service codebase

## Service architecture

PnL service consists of contract event listeners which track orders and trades
and a REST api which exposes tracked data.

## Database and migrations

PnL service uses Postgres 14+. [Prisma](https://www.prisma.io) is used for migration handling.

To run migrations for development:

```bash
npx prisma migrate dev
```

# TODO

[] Contract event listeners
[] DB functionality with prisma
[] REST Api with express
