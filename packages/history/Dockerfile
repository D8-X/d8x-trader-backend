
FROM node:18-bookworm

WORKDIR /app
COPY . . 
RUN yarn install
RUN npx lerna run build --scope=history

# Cd to history
WORKDIR packages/history

# Expose the provided API_PORT
EXPOSE ${MAIN_API_PORT_HTTP}

# CMD ["yarn", "run-production-reset"]
CMD ["yarn", "run-production"]

