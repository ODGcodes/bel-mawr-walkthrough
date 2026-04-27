[README.md](https://github.com/user-attachments/files/27128457/README.md)
# bel-mawr-walkthrough# Bel Mawr Walkthrough Logger

Voice-powered outdoor inspection logger for Bel Mawr Condominium Association. Board members walk the property, describe issues by voice on their phones, and the system logs entries to a Google Sheet. Photos can be uploaded and attached to specific issues.

## How It Works

1. Open the app on your phone
2. Tap "Start Walkthrough"
3. The AI assistant asks for each field one at a time: Address, Location, Rank, Category, Operating/Reserve, Description
4. Say "yes" to log the entry
5. Say "done" when finished

## Tech Stack

- **Frontend:** Single-page HTML app
- **Voice:** Vapi Web SDK + ElevenLabs TTS
- **Backend:** Netlify serverless functions
- **Storage:** Google Sheets API (service account auth via JWT)
- **Photos:** Netlify Blobs

## Project Structure

```
public/
  index.html        - Main app (voice logger + photo upload)
  review.html       - Review logged entries
  _redirects        - Short links for board members
netlify/
  functions/
    log-entry.mjs   - Writes walkthrough rows to Google Sheet
    photos.mjs      - Photo upload/retrieve/delete via Netlify Blobs
    review.mjs      - Reads Google Sheet for review page
netlify.toml        - Build config
package.json        - Dependencies (@netlify/blobs, jose)
```

## Google Sheet Columns

DATE ENTERED | ADDRESS | LOCATION | RANK 1-4 | CATEGORY | OPERATING OR RESERVE | DESCRIPTION | PHOTOS

## Categories

Sewer, Gutter/Downspouts, Bees/Hornets, Front Door/Entry Way, Landscaping, Sidewalk, Driveway, Garage, Paint, Deck, Dryer Vent, Siding

## Environment Variables (Netlify)

- `GOOGLE_SERVICE_ACCOUNT_EMAIL` - Service account email
- `GOOGLE_PRIVATE_KEY` - Service account private key (set manually in dashboard)
- `GOOGLE_SHEET_ID` - Google Sheet ID
