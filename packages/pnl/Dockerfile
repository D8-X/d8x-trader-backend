
FROM node:18-alpine

WORKDIR /app
COPY . . 
RUN yarn install
RUN npx lerna run build --scope=pnl

# Cd to PNL
WORKDIR packages/pnl

# Expose the provided API_PORT
EXPOSE ${API_PORT}

CMD ["yarn", "run-production"]

