# Creating managed database service

We will be using linode in this guide. Go ahead to your dashboard > Databases
and create a managed database. We recommend using more than 4GB ram for your
database server.

Make sure to add and whitelist your servers' IP addresses which will be used to
run the services and connect to freshly created postgres db in Access Controls
section.

To run History and Referrals services you will need to use 2 different
databases. These database can be hosted on the same cluster or it can even be a
different schemas in the same database. It's up to you to choose. For minmal
setup we recommend having 2 schemas on same database. We will assume you have 2
schemas: `history` and `referrals` in your `postgres` database in the exaples.

Provide the connection strings as `DATABASE_DSN_HISTORY` and `DATABASE_DSN_REFERRALS` environment variables in your
`.env` file. See
https://stackoverflow.com/questions/3582552/what-is-the-format-for-the-postgresql-connection-string-url/20722229#20722229
for more info about DSN structure.

# Deploying with docker swarm

For initial setup of main API we will use 3 servers with docker swarm. Go ahead
and create 3 ubuntu 22.04 boxes in your linode dashboard. Make sure you create
your servers in the same region. You can use the [host-setup](./host-setup.sh)
script to install docker.

Now for each created server, make sure you add a private IP address under
Network > Add IP address. Private IP addresses will be used for internal
communication between servers, without exposing them to public internet.

## Setting up the swarm

Now choose which one server will be your swarm manager. Take note of the private
IP address of the server which will be the swarm manager. For the sake of
simplicity we will use placeholder `<PRIVATE_IP_ADDR>` as our manager's private
IP address.

**Note if you have firewall enabled on your private network, make sure you allow
accessing docker swarm ports. See
[Docker swarm ports](https://docs.docker.com/engine/swarm/swarm-tutorial/#open-protocols-and-ports-between-the-hosts)**

To initialize swarm manager:

```bash
docker swarm init --advertise-addr <PRIVATE_IP_ADDR>
```

The output will be similar to this:

```bash
To add a worker to this swarm, run the following command:

    docker swarm join --token SWMTKN-1-1nrvcin1h110rjdo06hvs6h1a4l84asy1mbdxpvkt4219cb5fn-0i28e45cvwroytsem3p5l3l8q <PRIVATE_IP_ADDR>:2377

To add a manager to this swarm, run 'docker swarm join-token manager' and follow the instructions.
```

Before joining the swarm on your worker machines, for easier management, change
the hostnames of your worker machines. Replace the `worker-1` with any unique
name you wish to give to your machines. Run this command on all worker machines.

```bash
hostnamectl set-hostname worker-1
```

Copy the output `join` command from `swarm init` and run it on all of your
worker machines:

```bash
docker swarm join --token SWMTKN-1-1nrvcin1h110rjdo06hvs6h1a4l84asy1mbdxpvkt4219cb5fn-0i28e45cvwroytsem3p5l3l8q <PRIVATE_IP_ADDR>:2377
```

In case you lost the output of `docker swarm init`, you can list the join token
with the following command (on manager node):

```bash
docker swarm join-token worker
```

If you did the setup correctly, if you run `docker node ls` you will see similar
output:

```bash
ID                            HOSTNAME    STATUS    AVAILABILITY   MANAGER STATUS   ENGINE VERSION
8cpplvst7k7vt0q1puf5h6gx2 *   localhost   Ready     Active         Leader           20.10.25
uhjn2vhufdhlzqeyu4t50ntko     worker-1    Ready     Active                          20.10.25
m9v52l2egoczwqtddsk35gcqk     worker-2    Ready     Active                          20.10.25
```

To make sure that applications are not deployed on manager node, make sure to
set its availability to `DRAIN`. Change `<MANAGER_NODE_ID>` in the following
line with the ID of your managed node from `docker node ls` command:

```bash
docker node update <MANAGER_NODE_ID> --availability drain
```

## Deploying Main API

This guide assumes you have already pulled this repository on your manager host.

In order to deploy services to swarm, we need to build the images. We will be
using a local image registry that is running on our docker swarm to host our
main API image.

You can use any external container image registry or run local one in your swarm:

```bash
docker service create --name registry --publish 5555:5000 registry:latest
```

Firstly, edit your `live.*` configuration files in `config` directory. Currently
they are baked-in in the images at the image build time (this will be adjusted
in the future):

- `live.rpc.json`
- `live.referralSettings.json`
- `live.wsConfig.json`

Build the Main API image with the following command:

```bash
docker build -f ./packages/api/Dockerfile -t 127.0.0.1:5555/main:latest .
```

This will tag our image with our local registry prefix (`127.0.0.1:5555`). Now
let's push the image to our container registry. This step is needed to make our
image accesible to worker nodes.

Now push the image to our local image registry. This will make our image
accesible on worker nodes.

```bash
docker image push 127.0.0.1:5555/main:latest
```

Now add a `.env` file with environment variables and run the main api with the
following command:

```bash
docker service create --name main-api --env-file .env  127.0.0.1:5555/main:latest
```

## Securing ports

Make sure you deny all traffic except for

- Main API ports
- Docker swarm ports
- SSH (optional, depending on the setup)
