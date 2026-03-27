#!/bin/bash
cd /home/claude-dev/projects/TT_Auto/TT_Auto/dashboard

# Kill any existing instance on port 3838
lsof -ti:3838 | xargs kill -9 2>/dev/null

# Start Next.js dashboard in background
nohup npx next dev --port 3838 > /tmp/tt-auto-dashboard.log 2>&1 &

# Wait for server to be ready
for i in {1..15}; do
  if curl -s http://localhost:3838 > /dev/null 2>&1; then
    break
  fi
  sleep 1
done
