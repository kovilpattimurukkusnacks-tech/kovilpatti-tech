using KovilpattiSnacks.Business.DTOs.Products;

namespace KovilpattiSnacks.Business.Validators.Products;

// Inherits the 7 shared rules from ProductPayloadValidator. Code is now
// editable AND unbounded (07-Jun-2026, client #10) — no payload-specific
// rules; UNIQUE + NOT NULL on the DB column carry the integrity.
public class UpdateProductRequestValidator : ProductPayloadValidator<UpdateProductRequest> { }
