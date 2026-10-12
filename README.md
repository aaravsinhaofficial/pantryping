# PantryPing

A small, buildless food-pantry availability board for GitHub Pages. Visitors can check six food categories, filter stock, and read opening hours and visit requirements without an account.

**The included pantry and every availability status are fictional demo data. Do not use them to plan a visit.**

## Publish on GitHub Pages

1. Create a public GitHub repository named `pantryping`.
2. Add these files to the repository root, including `.nojekyll`.
3. Under **Settings → Pages**, select **Deploy from a branch**, **main**, and **/ (root)**, then save.
4. Wait for the GitHub Pages deployment to succeed. Open the URL shown by GitHub.

There is no build step, package installation, backend, API key, or database. All asset paths are relative so project Pages URLs work. If your repository name or owner differs, update the `github-upload` link in `index.html`.

## Update availability

1. Open **Pantry staff** on the site. Change stock statuses and, if needed, pantry details.
2. Review every category; mark anything you have not checked **Not confirmed**.
3. Check the confirmation box, then choose **Preview board** to inspect a local preview or **Download pantry.json** to export an update.
4. Upload the downloaded `pantry.json` to the repository root, replacing the old file, and commit the change. Only repository maintainers can publish updates.
5. Wait for Pages deployment and refresh the public site.

The editor is intentionally not a login-protected admin backend. Anyone can experiment with it, but previews and downloads cannot change the public board. Preview data exists only in that page's memory and is lost on reload. Never enter GitHub credentials or tokens in this app. Staff need GitHub repository access for the publishing step.

## Before using a real pantry

- Get the pantry's agreement and verify its public address, phone, hours, service area, requirements, and category names.
- Replace **all** fictional examples. The editor supports name, location, address, phone, hours, requirements, and note changes. Edit `pantry.json` to add or rename categories (up to 40).
- Uncheck **Keep this a clearly labeled demo** only after replacing and verifying the information.
- Reconfirm all stock categories when publishing. The editor timestamps this review. Category availability is not a reservation.
- App timestamps refer to the last inventory review, not the last visitor refresh. After 24 hours, or if the timestamp is missing or implausibly in the future, positive stock badges become **Not confirmed**, and the current-stock filter excludes them. Previously reported status remains visible for context.
- This version supports one pantry. It does not locate nearby pantries, send messages, reserve food, or provide real-time inventory synchronization.

## Privacy

The app collects no visitor information, uses no analytics, no geolocation, no local storage, no cookies of its own, and no external fonts or APIs. GitHub Pages handles standard hosting requests under GitHub's policies. All published JSON and source code are public. Include only approved public pantry information, never visitor names, student records, private phone numbers, or household details.

## Local development

```sh
python3 -m http.server 8000
# Open http://localhost:8000
node --test data.test.mjs
node --check app.mjs
```

ES modules and JSON fetching require an HTTP server; opening `index.html` directly with a `file:` URL is not supported. If data cannot load or validate, the app shows an error and no stock claims instead of quietly substituting sample data.

## Project structure

- `index.html`, `styles.css`, `favicon.svg`: accessible, responsive interface and original vector decoration.
- `app.mjs`: visitor filters, rendering, and staff editor.
- `data.mjs`: schema validation, freshness rules, and filtering.
- `pantry.json`: public pantry information and availability.
- `data.test.mjs`: boundary and validation checks.

## AI assistance and competition status

This initial implementation, visual design, demonstration data, documentation, and tests were generated with assistance from OpenAI's ChatGPT/Codex. It has not been submitted to any competition. Do not describe this implementation as entirely student-written. Any later competition submission must accurately disclose AI assistance and the student's own contributions, and comply with that competition's rules.
