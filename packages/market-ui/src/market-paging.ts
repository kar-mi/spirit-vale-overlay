export const MARKET_PAGE_SIZE = 50;
/** Listings held in the window's state at once. "Load more" stops here. */
export const MAX_VISIBLE_LISTINGS = 500;

export function nextVisibleLimit(visibleLimit: number): number {
  return Math.min(MAX_VISIBLE_LISTINGS, visibleLimit + MARKET_PAGE_SIZE);
}

/**
 * Whether the "Load more" button has anything left to reveal. It must go away at the cap as well as
 * at the end of the matches, or it renders and does nothing.
 */
export function hasMoreListings(matchCount: number, visibleLimit: number): boolean {
  return matchCount > visibleLimit && visibleLimit < MAX_VISIBLE_LISTINGS;
}
