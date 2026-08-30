import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { filterSettingsSections, normalizeSettingsSearch } from "./settings-search.ts";
import type { SectionId, SettingsSection } from "./settings-section.ts";

/** A request to jump to a section; `token` changes on every request so the same section can be re-requested. */
export interface SectionRequest {
  id: SectionId;
  token: number;
}

export interface SettingsLayoutProps {
  sections: SettingsSection[];
  requestedSection?: SectionRequest;
}

export function SettingsLayout({ sections, requestedSection }: SettingsLayoutProps) {
  const [sectionId, setSectionId] = useState<SectionId>("general");
  const [searchQuery, setSearchQuery] = useState("");
  const requestedId = requestedSection?.id;
  const requestedToken = requestedSection?.token;
  useEffect(() => {
    if (!requestedId) return;
    setSectionId(requestedId);
    setSearchQuery("");
  }, [requestedId, requestedToken]);
  const searching = normalizeSettingsSearch(searchQuery).length > 0;
  const searchResults = filterSettingsSections(searchQuery, sections);
  const matchedItemCount = searchResults.reduce((total, result) => total + result.itemIds.length, 0);
  const selectedSection = sections.find((section) => section.id === sectionId) ?? sections[0];

  const openSection = (id: SectionId): void => {
    setSectionId(id);
    setSearchQuery("");
  };

  const renderItems = (section: SettingsSection, itemIds?: readonly string[]): ComponentChildren => {
    const visibleIds = itemIds ? new Set(itemIds) : undefined;
    return section.items
      .filter((item) => !visibleIds || visibleIds.has(item.id))
      .map((item) => <div class="settings-item" key={item.id}>{item.content}</div>);
  };

  if (!selectedSection) return null;

  return <div class="settings-layout">
    <nav class="settings-sidebar" aria-label="Settings sections">
      {sections.map((section) => <button
        class={!searching && section.id === sectionId ? "settings-nav-item is-active" : "settings-nav-item"}
        type="button"
        aria-current={!searching && section.id === sectionId ? "page" : undefined}
        onClick={() => openSection(section.id)}
        key={section.id}
      >{section.label}</button>)}
    </nav>
    <div class="settings-main">
      <div class="settings-toolbar">
        <label class="settings-search">
          <span aria-hidden="true">⌕</span>
          <input class="input" type="search" value={searchQuery} onInput={(event) => setSearchQuery(event.currentTarget.value)} placeholder="Search settings" aria-label="Search all settings" />
        </label>
      </div>
      {searching ? <section class="settings-results" aria-label="Settings search results">
        <header class="settings-heading search-heading">
          <h1>Search results</h1>
          <p class="search-summary" aria-live="polite">{matchedItemCount === 0 ? `No settings match “${searchQuery.trim()}”.` : `${matchedItemCount} ${matchedItemCount === 1 ? "setting" : "settings"} found.`}</p>
        </header>
        {searchResults.map((result) => {
          const section = sections.find((candidate) => candidate.id === result.sectionId)!;
          return <section class="settings-result-group" aria-labelledby={`search-section-${section.id}`} key={section.id}>
            <header class="settings-result-heading"><h2 id={`search-section-${section.id}`}>{section.label}</h2><p>{section.description}</p></header>
            <div class="settings-panel">{renderItems(section, result.itemIds)}</div>
          </section>;
        })}
      </section> : <section class="settings-panel" aria-labelledby={`settings-section-${selectedSection.id}`}>
        <header class="settings-heading"><h1 id={`settings-section-${selectedSection.id}`}>{selectedSection.label}</h1><p>{selectedSection.description}</p></header>
        {renderItems(selectedSection)}
      </section>}
    </div>
  </div>;
}
