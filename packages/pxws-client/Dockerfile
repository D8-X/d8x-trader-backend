
FROM node:18-alpine

# sudo docker build . -t mytest -f ./src/Dockerfile --build-arg PORT=$PORT --build-arg PORT_WEBSOCKET=$PORT_WEBSOCKET --build-arg PORT_WEBSOCKET_CLIENT=$PORT_WEBSOCKET_CLIENT  --build-arg CHAIN_ID=$CHAIN_ID --build-arg REDIS_URL=$REDIS_URL 
# sudo docker run -it mytest
ARG PORT
ARG PORT_WEBSOCKET
ARG PORT_WEBSOCKET_CLIENT
ARG CHAIN_ID
ARG REDIS_URL

WORKDIR /app

# COPY package*.json ./
# COPY yarn.lock ./

#COPY . .
COPY ./packages/utils ./packages/utils
COPY ./packages/pxws-client ./packages/pxws-client
COPY ./package.json .
COPY ./nx.json .
COPY ./lerna.json .
COPY yarn.lock ./
COPY ./config/. ./config/.

RUN yarn install 


#Appended arguments need the below structure of the command to be work
RUN echo -e "PORT_WEBSOCKET=${PORT_WEBSOCKET}\n""PORT_WEBSOCKET_CLIENT=${PORT_WEBSOCKET_CLIENT}\n""PORT=${PORT}\n""REDIS_URL=${REDIS_URL}\n""CHAIN_ID=${CHAIN_ID}\n""SDK_CONFIG_NAME=${SDK_CONFIG_NAME}\n" > .env


# Build the pxws project
RUN npx lerna run build --scope pxws-client

#EXPOSED PORTS
EXPOSE ${PORT_WEBSOCKET_CLIENT}

CMD ["node", "packages/pxws-client/dist/startIndexPXWSClient.js"]
