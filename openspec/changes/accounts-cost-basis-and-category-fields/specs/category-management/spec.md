# category-management — delta

## ADDED Requirements

### Requirement: Category GST and HSN fields

The `categories` table SHALL carry `gst_rate numeric(5,2) NULL` and `hsn_code varchar(8) NULL`. Both SHALL be surfaced by `fn_category_list`, `fn_category_get` and `fn_category_tree`, accepted as optional parameters by `fn_category_create` and `fn_category_update`, and exposed through the Category DTOs and the admin category form (GST % field and HSN code field, both optional). Validation: `gst_rate` MUST be between 0 and 100 when present; `hsn_code` MUST be 4–8 digits when present. The fields are storage-only — no invoice, export, or pricing computation consumes them yet. Categories do NOT implicitly inherit a parent's values; each row stores its own.

#### Scenario: Create with GST and HSN

- **WHEN** an Admin creates a category with `gstRate = 12` and `hsnCode = "19059030"`
- **THEN** the category SHALL persist both values and return them on subsequent reads

#### Scenario: Fields are optional

- **WHEN** an Admin creates a category with neither field supplied
- **THEN** the create SHALL succeed with both stored as NULL

#### Scenario: Invalid GST rate rejected

- **WHEN** an Admin submits `gstRate = 150`
- **THEN** the API SHALL respond HTTP 400 with a field error on `gstRate`

#### Scenario: Invalid HSN rejected

- **WHEN** an Admin submits `hsnCode = "12"` or `hsnCode = "ABCD1234"`
- **THEN** the API SHALL respond HTTP 400 with a field error on `hsnCode`

### Requirement: Category page search

The Categories master page SHALL provide a client-side search box that filters the loaded category tree by case-insensitive name match, with no API call. Ancestors of a matching category SHALL remain visible (and expanded) so matches keep their tree context. Clearing the search SHALL restore the full tree and prior collapse state.

#### Scenario: Search filters the tree

- **GIVEN** categories "Snacks > Sweet > Big Biscuit" and "Beverages"
- **WHEN** the user types "biscuit"
- **THEN** "Big Biscuit" SHALL be visible with its ancestors "Snacks" and "Sweet", and "Beverages" SHALL be hidden

#### Scenario: Clearing restores the tree

- **WHEN** the user clears the search box
- **THEN** all categories SHALL be visible again

#### Scenario: No API call

- **WHEN** the user types in the search box
- **THEN** no network request SHALL be issued
