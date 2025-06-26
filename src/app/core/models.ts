// src/app/core/models.ts
export interface ExampleMeta {
  /** Unique key used by <wb-example id="…"> */
  id: string;

  /** Short title shown in the example card */
  title: string;

  /** URL to the live demo (StackBlitz, CodeSandbox, GitHub Pages, etc.) */
  stackblitz: string;

  /** Optional one-sentence blurb for gallery cards */
  description?: string;
}

// src/app/core/models.ts  (same file as ExampleMeta)

export interface DocMeta {
  /** Route-friendly slug, e.g. "getting-started" */
  slug: string;

  /** Display title, shown in nav menus */
  title: string;

  /** Category for organizing docs in menu */
  category?: string;

  /** Sort order within category */
  order?: number;

  /** YouTube video IDs referenced within the Markdown page */
  videos: string[];

  /** Example demos referenced on the page */
  examples: ExampleMeta[];
}
