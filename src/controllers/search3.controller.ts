import { Request, Response } from "express";
// import { SearchService3 } from "../services/search3.service";
import { llmSearchQuery, SearchValidationError } from "../lib";



export const searchController3 = async (req: Request, res: Response) => {
  try {
    const { query, filters, filter } = req.body;
console.log("test--",filters ?? filter)
    const result = await llmSearchQuery(query, filters ?? filter);

    res.json({
      success: true,
      ...result
    });
  } catch (err: any) {
    console.error("/search3 error:", err?.message || err);
    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
};
