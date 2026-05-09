import type { LoreArticleCanonStatus } from "./types";

export interface CreateLoreArticleRequest {
  title: string;
  content: string;
  category?: string;
  canonStatus?: LoreArticleCanonStatus;
  tags?: string[];
  entitySlugs?: string[];
}

export interface UpdateLoreArticleRequest {
  title?: string;
  content?: string;
  category?: string;
  canonStatus?: LoreArticleCanonStatus;
  tags?: string[];
  entitySlugs?: string[];
}

export interface LoreFilterParams {
  q?: string;
  category?: string;
  tag?: string;
  entity?: string;
}
