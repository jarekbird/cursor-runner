#!/bin/bash

# Script to create the shared Docker network for virtual-assistant services
# This network allows jarek-va and cursor-runner to communicate

NETWORK_NAME="virtual-assistant-network"

echo "Creating Docker network: $NETWORK_NAME"

# Check if network already exists
if docker network ls | grep -q "$NETWORK_NAME"; then
    echo "Network $NETWORK_NAME already exists"
    docker network inspect "$NETWORK_NAME" | grep -A 5 "Containers"
else
    # Create the network
    docker network create "$NETWORK_NAME"
    echo "Network $NETWORK_NAME created successfully"
fi

echo ""
echo "Network details:"
docker network inspect "$NETWORK_NAME" | grep -E "(Name|Driver|Subnet)"


