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
