#!/bin/sh

# Start scrap-by-newsletter.js
node --experimental-fetch scrap-by-newsletter.js

# Sleep for 5 seconds to ensure the server is ready
sleep 5

# Now, call the API and wait for it to complete
curl -X GET http://localhost:3000/scrape-emails

# Wait until the previous process completes
wait $!

# Sleep for 15 seconds before starting the next process
sleep 15

# Start scrap-organizer.js
node scrap-organizer.js
