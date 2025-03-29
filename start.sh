#!/bin/sh

# Start scrap-by-newsletter.js
node scrap-by-newsletter.js &
SCRAP_BY_NEWSLETTER_PID=$!

# Sleep for 5 seconds to ensure the server is ready
sleep 5

# Now, call the API and wait for it to complete
curl -X GET http://localhost:3000/scrape-emails

# Sleep for 15 seconds before starting the next process
sleep 15

# Kill the scrap-by-newsletter.js process
kill $SCRAP_BY_NEWSLETTER_PID

# Start scrap-organizer.js
node scrap-organizer.js
