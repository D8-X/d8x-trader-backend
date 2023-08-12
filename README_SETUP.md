# D8X Backend Setup

We recommend the following setup:

- A managed database service. The database hosts tables for historical trading data and the referral system
- Docker swarm with 3 servers. This component hosts the main API that the front-end communicates with via Websocket and REST API.
- Docker compose with 1 server that hosts a Redis cache, the components "history", "pxws-client", and "referral"

The documentation below walks through the setup of these services. Alternatively, one could set up everything on one server
using `docker-compose-all.yml`.

Separate and not documented here are (1) a "remote broker server" that hosts the key and signs, (2) candle data.

# Creating Managed Database Service

We will be using Linode in this guide. Go ahead to your dashboard > Databases
and create a managed database. We recommend using more than >=4GB RAM for your
database server.

Make sure to add and whitelist your servers' IP addresses which will be used to
run the services and connect to freshly created postgres db in Access Controls
section. We recommend connecting to your database via private IP address and
using servers in the same region.

To run History and Referrals services you will need to use 2 different
databases. These database can be hosted on the same cluster or it can even be a
different schemas in the same database. It's up to you to choose. For minmal
setup we recommend having 2 schemas on same database. We will assume you have 2
schemas: `history` and `referrals` in your `postgres` database in the exaples.

Provide the connection strings as `DATABASE_DSN_HISTORY` and
`DATABASE_DSN_REFERRALS` environment variables in your `.env` file. See
https://stackoverflow.com/questions/3582552/what-is-the-format-for-the-postgresql-connection-string-url/20722229#20722229
for more info about DSN structure.

# Host setup

Please note that you will need docker compose v2 for the deployment.
It is key to have Docker version >=24.0.5.
`host_setup.sh` helper script can be used to automate installation of latest
docker version.

## Configuration

Parameters for the backend services are found in the `./config` subdirectory at the root level.

- Copy the files in ./config/example.<name>.json into ./config/live.<name>.json (i.e., copy and replace prefix "example." with prefix "live.")
- live.rpc.json: A list of RPC URLs used for interacting with the different chains.
  - You are not required to make changes to this file, but you may add or remove as many RPCs as you need
  - It is encouraged to keep multiple HTTP options for best user experience/robustness
  - At least one Websocket RPC must be defined
- live.wsConfig.json: A list of price IDs and price streaming endpoints
  - You are encouraged to modify this configuration, but the services should be able to start with the default values provided
  - See the main API [readme](./packages/api/README.md) for details
- live.referralSettings.json: Configuration of the referral service

  - See the referral API [readme](./packages/referral/README.md) for details

## Server 1

In case your database uses ssl mode you might need to provide `sslrootcert` via
DSN query parameter for `DATABASE_DSN_REFERRAL`. In Linode dashboard you can
find "Download CA Certificate" link which will get you the ca certificate of
your database cluster. Place this certificate in the root directory of this
repository as `pg_ca_cert.ca` file. This file will be provided to
`backend_referral` service as `pg_ca_cert` config. You can reference it in your
`DATABASE_DSN_REFERRAL` DSN strings as`sslrootcert=/pg_ca_cert` query parameter.

The first server runs all services except the 'api-service' that is run via
docker swarm. Server 1 also communicates with the database. Make sure to set
environment variables `DATABASE_DSN_REFERRAL` and `DATABASE_DSN_HISTORY` to your
external postgres service connection strings for referral and history databases.

It is recommended to set a strong password for `REDIS_PASSWORD` variable. Also
make note of this password as you will need to use it when spinning up docker
swarm stack.

```bash
docker compose -f docker-compose-prod.yml up --build
```

This server also runs the REDIS database that the swarm needs s to, hence its IP needs to
be known to the docker swarm servers that we detail below. Add a private IP address for this communication
(Linode: Network > Add An IP Address > select Private > allocate).

# Deploying With Docker Swarm

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
sing docker swarm ports. See
[Docker swarm ports](https://docs.docker.com/engine/swarm/swarm-tutorial/#open-protocols-and-ports-between-the-hosts)**
For example:

```
sudo ufw allow 2377/tcp & sudo ufw allow 7946/tcp & sudo ufw allow 7946/udp

```

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

### Deploying Main API

This guide assumes you have already pulled this repository on your manager host.

In order to deploy services to swarm, we need to build the images. We will be
using a local image registry that is running on our docker swarm to host our
main API image.

You can use any external container image registry or run local one in your swarm:

```bash
docker service create --name registry --publish 5555:5000 registry:latest
```

To check the service is running: `sudo docker service ls`

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
image accessible to worker nodes.

Now push the image to our local image registry. This will make our image
accessible on worker nodes.

```bash
docker image push 127.0.0.1:5555/main:latest
```

Edit `.env` file with your environment variables and `source` it to make env
vars available in your current shell session before running deployment. Make
sure you edit important required variables such as:

- REDIS_URL - set the host to private ip address of server on which you ran
  `docker compose up` in [Server setup](#server-1-wip) section.
- BROKER_KEY
- BROKER_FEE_TBPS

You can explore `docker-stack.yml` for more available environment variables.

```bash
vim ./.env
...
. ./.env
```

Since docker stack deploy does not substitute env variables from your shell
session automatically, we can workaround this by processing `docker-stack.yml`
via docker compose. To run the main api, fire off the following command:

```bash
docker compose -f ./docker-stack.yml config | sed -E 's/published: "([0-9]+)"/published: \1/g' |  sed -E 's/^name: .*$/ /'|  docker stack deploy -c - stack
```

Why sed is used see [this issue](https://github.com/docker/compose/issues/9306).

Alternatively, you can manually create a service without the `docker stack deploy`

```bash
docker service create --name main-api --env-file .env --network the-network \
    --publish 3001:3001 --publish 3002:3002 --replicas 2 127.0.0.1:5555/main:latest
```

**Note that by default ports 3001 and 3002 are used and exposed as API and
Websockets ports.** If you wish, you can adjust these ports via environment
variables `PORT_REST` and `PORT_WEBSOCKET`.

List the docker stacks: `docker stack ls`
Display status: `docker stack ps <name>`

## Security

There are some security considerations that need to be taken care of. If you
followed the guide up to this point, you will have a publicly accessible Redis
instance on server where you ran `docker compose` as well as publicly accessible
Docker Swarm cluster with publicly exposed ports of main api as well as registry.

Additionally on running a firewall (for example ufw), we need to specifically
block ports.

### Securing REDIS From Server 1

Make sure you deny all traffic on public IP address for your redis container.
You will need to replace `<PUBLIC_IP>` with the public IP address of your server
where redis is running. This will reject packets coming to default redis port
6379 via public IP. Make sure you use your private network IP addresses when
connecting to redis instance on your docker swarm machines.

```bash
iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 6379 --ctorigdst <PUBLIC_IP> -j REJECT
```

### Securing Docker Swarm Nodes (Workers and Manager)

Since published services on docker swarm are accessible to public internet, it
is important to restrict access to ports exposed by swarm containers. This can
be done by rejecting any direct traffic to swarm servers' public IP addresses in
`DOCKER-USER` chain. The following iptables rules will drop all tcp and udp
connections to ports exposed from swarm containers deployed via `docker stack
deploy`. Make sure to run this on each swarm node and substitue the
`<PUBLIC_IP>` address of that corresponding server.

```bash
iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdst <PUBLIC_IP> -j DROP
iptables -I DOCKER-USER -p udp -m conntrack --ctorigdst <PUBLIC_IP> -j DROP
```

### Persisting IPTables Rules

All iptables rules that you have set via shell are lost when server restarts.
Therfore we need to make sure they are persisted between reboots. To do so, we
will dump updated iptables rules and load them on server startup. We can use
`iptables-persistent` to manage iptables persistence.

```bash
apt-get install -y iptables-persistent
```

Whenever you modify iptables, to persist them run:

```bash
netfilter-persistent save
```

Other considerations:

- SSH (optional, depending on the setup)

## Setting Up Nginx and Certbot

Our example setup uses Nginx and Certbot, to estables secured connection (SSL/TLS) to the backend components.
Nginx can differ depending on choices such as rate limiting, and port usage set in .env.
Here we provide a guide that works with the example setting without rate limits.

### SSL/TLS

#### A-Name Entries

We require the following A-name entries which you can set up on your domain provider's website:

- Pointing to the IP of server1: history, referral. For example: history.main.yourdomain.com, referral.main.yourdomain.com
- Pointing to the IP of the swarm manager: api, ws. For example: ws.main.yourdomain.com, api.main.yourdomain.com

#### Certbot

Setup certificates with Certbot on Server 1 and the Swarm manager.
Install Nginx via `sudo apt install nginx` on the Swarm manager and Server 1.

Then follow this guide to install Certbot:
[Linode Certbot howto](https://www.linode.com/docs/guides/enabling-https-using-certbot-with-nginx-on-ubuntu/)

- On Server 1: history, referral. For example: history.main.yourdomain.com, referral.main.yourdomain.com
- On the Swarm manager: api, ws. For example: ws.main.yourdomain.com, api.main.yourdomain.com

#### Nginx For Server 1

See for example [the Linod guidance on Nginx](https://www.linode.com/docs/guides/how-to-install-and-use-nginx-on-ubuntu-20-04/#manage-nginx).
A configuration could look like this

```
server {
        server_name referral.dev.yourdomain.com;
        ssl_certificate /etc/letsencrypt/live/api.main.yourdomain.com/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/api.main.yourdomain.com/privkey.pem;
        listen 443 ssl;
        location / {
                proxy_pass http://127.0.0.1:8889;
                proxy_set_header Host $host;
                proxy_set_header X-Real-IP $remote_addr;
                proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                #CORS:
                add_header 'Access-Control-Allow-Origin' '*';
                add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS';
                add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range';
                add_header 'Access-Control-Expose-Headers' 'Content-Length,Content-Range';

        }
}
server {
        server_name history.yourdomain.com;
        listen 443 ssl;
        location / {
                proxy_pass http://127.0.0.1:8888;
                proxy_set_header Host $host;
                proxy_set_header X-Real-IP $remote_addr;
                proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                #CORS:
                add_header 'Access-Control-Allow-Origin' '*';
                add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS';
                add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range';
                add_header 'Access-Control-Expose-Headers' 'Content-Length,Content-Range';
        }
}

```

#### Nginx for docker swarm

Swarm hosts main api which is an API + Websockets server. Default port for main
API is `3001` and `3002` for websockets (see `docker-stack.yml`). If you modify
default ports via env or other ways, make sure you adjust and `proxy_pass`
directives with appropriate values.

For example if you are running `ws.main.yourdomain.com` subdomain, your certificates
have been stored to `api.main.yourdomain.com` and
your websockets port is set to `8080`, you can proxy websocket traffic with:

```conf
server {
  server_name ws.main.yourdomain.com;
  ssl_certificate /etc/letsencrypt/live/api.main.yourdomain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.main.yourdomain.com/privkey.pem;

  listen 443 ssl;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_read_timeout 60;
    proxy_connect_timeout 60;
    proxy_redirect off;

    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    #CORS:
    add_header 'Access-Control-Allow-Origin' '*';
    add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS';
    add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range';
    add_header 'Access-Control-Expose-Headers' 'Content-Length,Content-Range';
  }
}
```

Note the `upgrade` headers - they are required for upgrading to ws connection.

For the rest api, minimal nginx config could look like this:

```conf
server {
  server_name api.main.yourdomain.com;
  ssl_certificate /etc/letsencrypt/live/api.main.yourdomain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.main.yourdomain.com/privkey.pem;

  listen 443 ssl;

  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    #CORS:
    add_header 'Access-Control-Allow-Origin' '*';
    add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS';
    add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range';
    add_header 'Access-Control-Expose-Headers' 'Content-Length,Content-Range';
  }
}
```