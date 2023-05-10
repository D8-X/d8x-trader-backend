#!/bin/env bash

DIST_DIR="$(pwd)/dist/price_fetcher.js"

# Required environment variables for this script 
REQUIRED_ENV=("DATABASE_URL" "SDK_CONFIG_NAME")

for E in "${REQUIRED_ENV[@]}"; do
    if [[ -z ${!E} ]]; then
        echo "Please provide environment variable ${E}"
        exit 1
    else
        echo "Using ${E}=${!E}"
    fi
done

if [ ! -f "$DIST_DIR" ];then
    echo "${DIST_DIR} file not found, make sure you run cron_installer.sh from the pnl root directory"
    exit 1
else
    echo "${DIST_DIR} found.";
fi

echo "Creating crontab entry to fetch price info daily";
CRON_ENTRY="0 0 * * * export DATABASE_URL='${DATABASE_URL}'; export SDK_CONFIG_NAME='${SDK_CONFIG_NAME}'; node ${DIST_DIR}"
echo "$CRON_ENTRY"

if  crontab -l | grep -qF "$CRON_ENTRY"; then
    echo "Crontab entry already added!";
else
(crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -
fi



