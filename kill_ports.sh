#!/bin/bash

echo "Killing processes on ports 3001, 3002, and 5173..."
lsof -ti :3001,3002,5173 | xargs kill -9 2>/dev/null
echo "Processes killed."
