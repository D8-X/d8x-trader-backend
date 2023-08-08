#!/bin/bash

# Minimal script to install required dependencies on host

if [[ $EUID != 0 ]]; then
    echo "run this script as root!"
    return 1
fi

# Update repos
apt-get update -y 

# Install docker
apt-get install docker.io docker-compose -y



