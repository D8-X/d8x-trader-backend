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
