# Invoice Extraction Test Fixtures

This directory contains HTML mock files simulating commercial invoice documents for testing the invoice extraction evaluator.

## Files

- **invoice-001.html**: Complete invoice with all fields, 8 line items (perfect extraction scenario)
- **invoice-002.html**: Minimal invoice testing supplier name spacing variation ("Acme - Shipping")
- **invoice-003.html**: Invoice with rounding test (totals 1889.50 vs expected 1889)
- **invoice-004.html**: Incomplete invoice missing required invoice_number field
- **invoice-005.html**: Partial invoice with only first 2 line items

## Why HTML instead of PDF?

These HTML files serve as simplified test fixtures that:
- Are readable and versionable in git
- Can be easily modified for test scenarios
- Simulate the structured data that would be extracted from real PDFs
- Avoid binary PDF files in the repository

## Real-World Usage

In production, you would:
1. Use actual PDF invoices as input
2. Run OCR/extraction tool (Azure Form Recognizer, Tesseract, etc.)
3. Extract structured JSON data
4. Evaluate extracted data against expected values using field_accuracy evaluator

The mock_extractor.ts script demonstrates this pattern by parsing HTML and outputting JSON.
