# FleetCare

FleetCare helps small delivery businesses keep vehicle records, fuel purchases, service history, and operating costs in one place. The MVP uses React and Vite for the web app, Express for the REST API, and MongoDB Atlas with Mongoose for persistent records.

## Requirements

- Node.js 20.19+ and npm
- A MongoDB Atlas cluster (or another MongoDB deployment)

## Local setup

1. Install each app's dependencies from the project root:

   ```powershell
   npm install --prefix Backend
   npm install --prefix Frontend
   ```

2. Create the backend environment file:

   ```powershell
   Copy-Item Backend/.env.example Backend/.env
   ```

3. Edit `Backend/.env` and set `MONGODB_URI` to your MongoDB Atlas connection string and `JWT_SECRET` to a long, random secret. `MONGO_URL` is also accepted for existing local configurations. In Atlas, create a database user and allow the development machine's IP address. Keep `.env` private; it is ignored by Git.

   If registration shows that the API cannot be reached, check that the Backend terminal is running without a startup error. The API will not start until it has a valid MongoDB URI and `JWT_SECRET`; account registration requires the database connection and does not create fake/local accounts.

   On Windows, if Node.js cannot resolve an Atlas `mongodb+srv` record but Windows DNS can, the backend automatically retries using the SRV records resolved by Windows.

4. Start the API and web app in separate terminals:

   ```powershell
   npm run dev --prefix Backend
   ```

   ```powershell
   npm run dev --prefix Frontend
   ```

   Open the Vite URL printed by the frontend, normally `http://localhost:5173`. Vite forwards `/api` requests to `http://localhost:4000`.

## MVP functionality

- Business registration and sign-in with bcrypt password hashing and signed JWT sessions.
- Per-business currency preference (Ghana cedis by default; USD, GBP, EUR, NGN, XOF, and ZAR are also available).
- Light, dark, and system-following appearance modes, saved in the current browser.
- Business-scoped vehicle management and vehicle history.
- Fuel and maintenance CRUD, vehicle/date filters, and expense totals.
- Dashboard summaries and six-month expense chart calculated from MongoDB records.
- Upcoming and overdue service reminders based on entered dates (within 30 days) and odometer schedules (within 500 km).
- Per-vehicle expense report with CSV export.
- Fuel-use estimates and practical reminders based on recorded fuel and odometer history.
- Excel-compatible CSV fuel import with a downloadable template, preview, duplicate detection, and row-level error reporting.

The app starts with empty states. Dashboard values are derived from saved records; no operational figures are seeded or hardcoded. Currency is selected in Settings and controls display and entry labels; changing it does not convert amounts already recorded.
Appearance is selected in Settings and saved locally in the browser; System follows the device's current light/dark preference.

Fuel-use trends need at least three fuel entries with increasing odometer readings and assume each entry represents a full tank. They are estimates, not vehicle diagnoses. To import fuel from Excel, download the fuel template from Reports, fill it in, save it as a CSV file, then choose it in the import section. Imports match registration numbers to existing vehicles and show a preview before saving.

## API

All records except account registration, sign-in, and health checks require `Authorization: Bearer <token>`.

- `GET /api/health`
- `GET /` (service status for hosting health checks)
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET|POST /api/vehicles`, `PATCH|DELETE /api/vehicles/:id`
- `GET /api/vehicles/:id/history`
- `GET|POST /api/fuel`, `PATCH|DELETE /api/fuel/:id`
- `GET|POST /api/maintenance`, `PATCH|DELETE /api/maintenance/:id`
- `GET /api/dashboard`

List endpoints accept optional `vehicleId`, `from`, and `to` query parameters. API records are always scoped to the signed-in business. A vehicle with fuel or maintenance history cannot be deleted; mark it inactive to preserve its records.

## Production deployment

Deploy `Backend` as a Node service with `MONGODB_URI`, `JWT_SECRET`, `PORT`, and `CLIENT_ORIGIN` configured in the hosting provider. Build the client with `npm run build --prefix Frontend` and host `Frontend/dist` as static files. Configure the production web host or reverse proxy to forward `/api/*` to the API service, and set `CLIENT_ORIGIN` to the deployed web origin.

## Checks

```powershell
npm run lint --prefix Frontend
npm run build --prefix Frontend
npm run check --prefix Backend
```