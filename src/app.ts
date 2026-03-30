import express from "express";
import { searchController3 } from "./controllers/search3.controller";
import { requestLogger } from "./utils/requestLogger";

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(requestLogger());
  app.post("/search", searchController3);

  return app;
}