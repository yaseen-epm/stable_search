import { Request, Response } from "express";
import { llmSearchQuery, SearchValidationError } from "../lib";

export const searchController3 = async (req: Request, res: Response) => {
  try {
    const result = await llmSearchQuery(req.body?.query);

    res.json({
      success: true,
      ...result
    });
  } catch (err: any) {
    if (err instanceof SearchValidationError) {
      return res.status(err.statusCode).json({
        success: false,
        error: err.message
      });
    }

    console.error("/search error:", err?.message || err);
    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
};
