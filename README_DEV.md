# Monorepo setup

This project users [lerna](https://lerna.js.com) for monorepo management.

Project packages can be found under `packages` directory

To build all packages

```bash
npx lerna run build
```

## Docker setup

Each build target package directory has a `Dockerfile`.

Individual packages must be built with root of this repo as docker context.

Docker compose can be used to spin up all services:

```bash
docker compose  --env-file .env up
```

## Run without Docker

```bash
yarn lerna run build
cd packages/utils/
yarn link
cd ../api
yarn link utils
cd ../pxws-client/
yarn link utils
```

If you need to rebuild the package (e.g. change of wsConfig), repeat but first `yarn unlink`.

Now you can run the packages pxws-client and api from the root folder, e.g.,
`ts-node ./packages/pxws-client/src/indexPxWSClient.ts `

# Docker compose setup

You can spin up all services from this repo + Postgres database via `docker
compose`. Copy the `.envExample` contents to `.env` file.
Then to start all services simply run:

```bash
docker compose up --build
```

On the first run this will initialize postgres database in a docker container
with a named volume `pgdb` with credentials and db name specified by
`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` variables from `.env` file.
Make sure to not change these credentials after postgres is initialized,
otherwise you might get authentication errors (or will need to rebuild the
database).

**Note that initially it might take up to a minute to download historical data from
the blockchain**

## Inspecting the database

You can inspect the database via `psql` or any other GUI tool such as DBeaver.
The port (5432 by default) is set and exposed in `docker-compose.yml` file. You
can connect to your `POSTGRES_DB` database with `POSTGRES_USER` and
`POSTGRES_PASSWORD` credentials that you provided in your `.env` file on the
first `docker compose up` run.

```
psql "dbname=db host=localhost user=user password=password port=5432"
```

# Development

# Reset database

During the development phase the layout of the database can change. Here is how to reset the database. All data will be lost but
is reconstructed from on-chain events, except for the tables `referral_code` and 'referral_code_usage`.

- run docker compose as detailed above
- `npx prisma migrate reset --schema packages/utils/prisma/schema.prisma`
- `npx prisma migrate dev --schema packages/utils/prisma/schema.prisma`
- restart docker compose

# Updating packages with lerna

You can update packages for each subpackage via `lerna exec`. For example to
update to latest `@d8x/perpetuals-sdk` version:

```bash
npx lerna exec -- yarn upgrade @d8x/perpetuals-sdk@latest
```

# Services

Each service has its own README where you can find more documentation about the
functionality of the service. You can find information about API endpoints,
data, setup, etc of each service in its respective README doc.

- [API](./packages/api/README.md) - main backend http and websockets API documentation
- [HISTORY](./packages/history/README.md) - profit and loss, historical trades, APY API documentation
- [PXWS-Client](./packages/pxws-client/README.md) - off-chain index price data streaming
- [REFERRAL](./packages/referral/README.md) - referral system
