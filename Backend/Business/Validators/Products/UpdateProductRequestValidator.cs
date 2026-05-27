using KovilpattiSnacks.Business.DTOs.Products;

namespace KovilpattiSnacks.Business.Validators.Products;

// Inherits the 7 shared rules from ProductPayloadValidator. No payload-specific
// rules on Update — Code is set at create time and not editable.
public class UpdateProductRequestValidator : ProductPayloadValidator<UpdateProductRequest> { }
