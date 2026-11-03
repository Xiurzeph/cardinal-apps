# To Do

## Requirement 1: Letter Writing / Door-to-Door view toggle

Add the ability to switch back and forth between two views of the currently opened batch.

### 1a. View switcher
- [x] Add a toggle control to switch between **Letter Writing** and **Door-to-Door** views at any time without reloading the batch.
- [x] Remember the selected view while the batch is open.

### 1b. Letter Writing view
- [x] Shows all results **in groups** (existing street groupings).
- [x] The **street number filter is not shown/applied** in this view.

### 1c. Door-to-Door view
- [x] Shows all results as a **flat list, not grouped**.
- [x] Add a new filter, titled **"Status"**, to choose which statuses are included in the currently opened batch (multi-select; filters the list only). "Choose Status", "Home" and "Letter" are not offered; "Not Home" covers Busy and Not Home 1-3.
- [x] Add a **Street name** dropdown filtering on the street names in the batch.
- [x] Rename the street number heading to "Street number sort".

## Requirement 3: UI polish
- [x] Make toasts less obtrusive on mobile: smaller, translucent, click-through, tap to dismiss, 2s duration.
- [x] Show at most 2 toasts; queue extras behind a `+N` badge that shrinks as toasts time out.
- [x] Rename the status label to "⚠️ No Trespassing" (stored value unchanged).
- [x] Make "Property addresses" collapsible, collapsed by default when a batch is opened or fetched.

## Requirement 4: Visual improvements

### Door-to-Door
- [x] Collapse filters behind a "Filters" button with an active-count badge and a "Clear all" link.
- [x] Sticky header with the view toggle, "N of M" count, and progress.
- [x] Address rows as cards with a large address and a colored status pill (tap to change).
- [x] Visited progress bar ("Visited 18 / 48"); status chips are colored and scroll horizontally.

### Letter Writing
- [x] Sticky, lighter group headers; completed groups show a check instead of fading the card.
- [x] Replace the status summary bar with the shared progress bar (plus per-group visited dot/count).

### General
- [x] Consistent corner radius, spacing and 40px minimum tap targets.
- [x] Empty state with icon and hint; skeleton rows while fetching.
- [x] Distinct color for "Not Home 3".
- [x] Print header with batch name, date and counts; group tag (G#) on every Door-to-Door card.

## Requirement 2: Include Do Not Knocks in batch fetch

- [x] Currently, Do Not Knock addresses are filtered out on batch fetch. Stop filtering them out.
- [x] Include them in the results list and assign them the **Do Not Call** status.
- [x] Make sure they are selectable/hideable via the new Door-to-Door **Status** filter.
