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
- [x] Add a new filter, titled **"Status"**, to choose which statuses are included in the currently opened batch (multi-select; filters the list only). "Choose Status" is not offered as a filter option.

## Requirement 3: UI polish
- [x] Make toasts less obtrusive on mobile: smaller, translucent, click-through, tap to dismiss, 2s duration.
- [x] Show at most 2 toasts; queue extras behind a `+N` badge that shrinks as toasts time out.
- [x] Rename the status label to "⚠️ No Trespassing" (stored value unchanged).
- [x] Make "Property addresses" collapsible, collapsed by default when a batch is opened or fetched.

## Requirement 2: Include Do Not Knocks in batch fetch

- [ ] Currently, Do Not Knock addresses are filtered out on batch fetch. Stop filtering them out.
- [ ] Include them in the results list and assign them the **Do Not Call** status.
- [ ] Make sure they are selectable/hideable via the new Door-to-Door **Status** filter.
