// src/index.ts
import express from "express";
import { searchController3 } from "./controllers/search3.controller";
import { requestLogger } from "./utils/requestLogger";

const app = express();
app.use(express.json());
app.use(requestLogger());

app.post("/search", searchController3);

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
