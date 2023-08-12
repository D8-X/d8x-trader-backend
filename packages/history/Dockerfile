
FROM node:18-alpine

WORKDIR /app
COPY . . 
# COPY ./packages/utils/. ./packages/utils
# COPY ./packages/history/. ./packages/history
# COPY ./package.json .
# COPY ./nx.json .
# COPY ./lerna.json .
# COPY ./config/. ./config/.

RUN yarn install
RUN npx lerna run build --scope=history

# Cd to history
WORKDIR packages/history

# Expose the provided API_PORT
EXPOSE ${API_PORT}

# CMD ["yarn", "run-production-reset"]
CMD ["yarn", "run-production"]

