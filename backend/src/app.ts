import "dotenv/config";
import "express-async-errors";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";
import bulkAccountsRoutes from "./routes/bulkAccounts";
import academicRoutes from "./routes/academic";
import icaRoutes from "./routes/ica";
import resultsRoutes from "./routes/results";
import settingsRoutes from "./routes/settings";
import gpaRoutes from "./routes/gpa";
import pdfRoutes from "./routes/pdf";
import assignmentRequestsRoutes from "./routes/assignmentRequests";

const app = express();
// FRONTEND_URL, if set, restricts CORS to that one origin — useful once the frontend is deployed
// to a known URL (see README → "Deploying SARMS"). Left unset, CORS stays wide open (any origin),
// which is what keeps local development and quick demos working with zero configuration.
app.use(cors(process.env.FRONTEND_URL ? { origin: process.env.FRONTEND_URL } : undefined));
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "sarms-backend" }));

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/bulk", bulkAccountsRoutes);
app.use("/api/academic", academicRoutes);
app.use("/api/ica", icaRoutes);
app.use("/api/results", resultsRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/gpa", gpaRoutes);
app.use("/api/pdf", pdfRoutes);
app.use("/api/admin/assignment-requests", assignmentRequestsRoutes);

// Centralised error handler — anything an inner route throws lands here instead of crashing
// the process, and the client always gets a JSON error body.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(err.status ?? 500).json({ error: err.message ?? "Internal server error." });
});

export default app;
