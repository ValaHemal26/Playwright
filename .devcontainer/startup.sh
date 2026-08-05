#!/bin/bash

# Start Xvfb (Virtual display)
Xvfb :99 -screen 0 1366x768x24 -ac +extension GLX +render -noreset &
export DISPLAY=:99

# Wait a second for Xvfb to initialize
sleep 1

# Start x11vnc (VNC Server)
x11vnc -display :99 -nopw -listen localhost -shared -forever &

# Wait a second for x11vnc to initialize
sleep 1

# Start Websockify Proxy (Port 6080)
websockify --web /usr/share/novnc 6080 localhost:5900 &

# Enter backend folder and start the worker process in the background
cd /workspaces/Playwright/backend
export ORACLE_AUTH_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fe353d3r3rgu4hg87fhet.g4gvry45ybb6vr5h5vrh5yhrvrth-QV30
node oracle-worker.js &
