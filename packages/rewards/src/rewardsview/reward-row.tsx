import { Fragment } from "preact";
import { safeDomId } from "@svoverlay/ui-kit/sortable-header";
import { formatPercentageValue } from "@svoverlay/ui-kit/format";
import type { RewardsUiDrop } from "../app-types.ts";

export function RewardRow({ rowKey, name, values, drops, trailingValues = [], expanded, onToggle }: { rowKey: string; name: string; values: readonly string[]; drops: readonly RewardsUiDrop[]; trailingValues?: readonly string[]; expanded: ReadonlySet<string>; onToggle(key: string): void }) {
  const isExpanded = expanded.has(rowKey);
  const detailId = `reward-drops-${safeDomId(rowKey)}`;
  return <Fragment>
    <tr>
      <th scope="row" title={name}>{name}</th>
      {values.map((value, index) => <td key={index}>{value}</td>)}
      <td>{drops.length === 0 ? "—" : <button class="table-detail-button" type="button" aria-expanded={isExpanded} aria-controls={detailId} onClick={() => onToggle(rowKey)}>{isExpanded ? "▾" : "▸"} {drops.length}</button>}</td>
      {trailingValues.map((value, index) => <td key={`trailing-${index}`} title={value}>{value}</td>)}
    </tr>
    {isExpanded && drops.length > 0 && <tr id={detailId} class="table-detail-row"><td colSpan={values.length + trailingValues.length + 2}><div class="table-detail-chips">{drops.map((drop, index) => <span class="chip" key={`${drop.itemId}-${index}`}>{formatDrop(drop)}</span>)}</div></td></tr>}
  </Fragment>;
}

function formatDrop(drop: RewardsUiDrop): string {
  return `${drop.itemName} ×${drop.count}${drop.chance === undefined ? "" : ` · ${formatPercentageValue(drop.chance)}`}`;
}
