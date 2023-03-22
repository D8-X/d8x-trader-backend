
FROM node:18-alpine
#The arguments inherited from GitHub variables
ARG PORT
ARG PORT_WEBSOCKET
ARG PORT_WEBSOCKET_CLIENT
ARG CHAIN_ID
ARG REDIS_URL

WORKDIR /app

COPY package*.json ./

COPY yarn.lock ./

RUN yarn install 

COPY . .

#Appended arguments need the below structure of the command to be work
RUN echo -e "PORT_WEBSOCKET=${PORT_WEBSOCKET}\n""PORT_WEBSOCKET_CLIENT=${PORT_WEBSOCKET_CLIENT}\n""PORT=${PORT}\n""REDIS_URL=${REDIS_URL}\n""CHAIN_ID=${CHAIN_ID}\n" > .env

RUN yarn build

#EXPOSED PORTS
EXPOSE ${PORT_REST}
EXPOSE ${PORT_WEBSOCKET}

CMD ["yarn", "start"]

