# FleetCare API

Express REST API for FleetCare business, vehicle, fuel, and maintenance records. Records are stored in MongoDB through Mongoose and scoped to the signed-in business.

For environment setup, local run commands, API routes, and deployment guidance, see the project [README](../README.md).

API route handlers are organized in `Backend/routes/api.js` and mounted under `/api` by `Backend/server.js`. Keep new endpoint definitions in the routes folder; the server file is for application setup, models, and database startup. Shared Express middleware lives in `Backend/middleware`.

Start the API from the project root with:

```powershell
npm run dev --prefix Backend
```
