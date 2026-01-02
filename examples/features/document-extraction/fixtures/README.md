# Document Extraction Test Fixtures

This directory contains JSON mock files representing extracted invoice data for testing the field_accuracy evaluator.

## Files

- **invoice-001.json**: Complete invoice with all fields and 8 line items (perfect extraction scenario)
- **invoice-002.json**: Minimal invoice with supplier name "Acme - Shipping" (fuzzy matching test)
- **invoice-003.json**: Invoice with decimal amounts 1889.5 vs expected 1889 (numeric tolerance test)
- **invoice-004.json**: Incomplete invoice missing invoice_number field (required field test)
- **invoice-005.json**: Partial invoice with only first 2 line items (array validation test)

## Intentional Variations

These fixtures contain realistic extraction variations to test the evaluator:
- **invoice-002**: Preserves OCR-like formatting ("Acme - Shipping" with hyphen/spaces)
- **invoice-003**: Decimal precision preserved (1889.5) to test ±$1 tolerance
- **invoice-004**: Missing invoice_number field to test required field penalty

## Why JSON instead of PDF?

These JSON files simulate **already-extracted** invoice data, representing the output of an OCR/extraction system:
- Readable and versionable in git
- Fast to test and iterate
- Clear demonstration of evaluator features without PDF parsing complexity
- Focuses on the **evaluation** logic, not document processing

## Real-World Usage

In production, you would:
1. Use actual PDF/image invoices as input
2. Run OCR/extraction tool (Azure Form Recognizer, Tesseract, vision models, etc.)
3. Extract structured JSON data (like these fixtures)
4. Evaluate extracted data against expected values using field_accuracy evaluator

The mock_extractor.ts script simulates this by simply reading these JSON files.
