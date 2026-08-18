export interface SearchableSettingItem {
  id: string;
  searchText: string;
}

export interface SearchableSettingsSection {
  id: string;
  label: string;
  description: string;
  items: readonly SearchableSettingItem[];
}

export interface SettingsSearchResult {
  sectionId: string;
  itemIds: string[];
}

export function normalizeSettingsSearch(query: string): string[] {
  return query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
}

export function filterSettingsSections(
  query: string,
  sections: readonly SearchableSettingsSection[],
): SettingsSearchResult[] {
  const tokens = normalizeSettingsSearch(query);
  if (tokens.length === 0) return [];

  return sections.flatMap((section) => {
    const sectionText = `${section.label} ${section.description}`.toLocaleLowerCase();
    const itemIds = section.items
      .filter((item) => {
        const searchableText = `${sectionText} ${item.searchText}`.toLocaleLowerCase();
        return tokens.every((token) => searchableText.includes(token));
      })
      .map((item) => item.id);
    return itemIds.length > 0 ? [{ sectionId: section.id, itemIds }] : [];
  });
}
