export const MARKET_PAGE_SIZE = 50;
/**
 * Listings held in the window's state at once. "Load more" stops here.
 *
 * Deliberately low: the in-game market is currently unavailable, so there is no live capture to
 * size this against. Two pages keeps the control exercisable while the window's retained state
 * stays trivial. Revisit once real listing volumes can be measured — see `.agents/todo.md`.
 */
export const MAX_VISIBLE_LISTINGS = 100;

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
