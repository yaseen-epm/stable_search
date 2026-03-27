import { Request, Response } from "express";
import { SearchService3 } from "../services/search3.service";

const service3 = new SearchService3();

export const searchController3 = async (req: Request, res: Response) => {
  try {
    const { query } = req.body;

    if (typeof query !== "string" || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Query required"
      });
    }

    if (query.length > 500) {
      return res.status(400).json({
        success: false,
        error: "Query too long"
      });
    }

    const result = await service3.search(query.trim());

    res.json({
      success: true,
      ...result
    });
  } catch (err: any) {
    console.error("/search error:", err?.message || err);
    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
};
