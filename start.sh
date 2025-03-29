#!/bin/sh

# Start scrap-by-newsletter.js
node scrap-by-newsletter.js &

sleep 5

# call API
curl -X GET http://localhost:3000/scrape-emails

sleep 15

# Start scrap-organizer.js
node scrap-organizer.js