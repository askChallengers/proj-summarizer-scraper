#!/bin/sh

# Start scrap-by-newsletter.js
node scrap-by-newsletter.js

# Sleep for 5 seconds to ensure the server is ready
sleep 5

# Sleep for 15 seconds before starting the next process
sleep 15

# Start scrap-organizer.js
node scrap-organizer.js
