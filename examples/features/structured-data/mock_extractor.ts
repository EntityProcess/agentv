#!/usr/bin/env bun
/**
 * Mock Invoice Extractor
 * 
 * This is a placeholder CLI that simulates invoice extraction from HTML files.
 * In a real implementation, this would:
 * - Parse PDF/images using OCR (e.g., Azure Form Recognizer, Tesseract)
 * - Extract structured data using vision models or layout analysis
 * - Return JSON with invoice fields and bounding boxes
 * 
 * For this example, it simply reads HTML and extracts text content.
 * 
 * Usage: bun run mock_extractor.ts <input-file>
 */

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

interface InvoiceData {
  invoice_number?: string;
  invoice_date?: string;
  incoterm?: string | null;
  currency?: string;
  net_total?: number;
  gross_total?: number;
  supplier?: {
    name?: string;
    address?: string;
  };
  importer?: {
    name?: string;
    address?: string;
  };
  line_items?: Array<{
    description?: string;
    product_code?: string | null;
    quantity?: number;
    unit_price?: number;
    line_total?: number;
    unit_type?: string;
    hs_code?: string;
  }>;
}

function extractInvoiceData(htmlPath: string): InvoiceData {
  const html = readFileSync(htmlPath, "utf-8");
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const data: InvoiceData = {};

  // Extract header fields
  const invoiceNumberEl = Array.from(doc.querySelectorAll("p")).find(p => 
    p.textContent?.includes("Invoice Number:")
  );
  if (invoiceNumberEl) {
    data.invoice_number = invoiceNumberEl.textContent?.split(":")[1]?.trim();
  }

  const invoiceDateEl = Array.from(doc.querySelectorAll("p")).find(p => 
    p.textContent?.includes("Invoice Date:")
  );
  if (invoiceDateEl) {
    data.invoice_date = invoiceDateEl.textContent?.split(":")[1]?.trim();
  }

  const currencyEl = Array.from(doc.querySelectorAll("p")).find(p => 
    p.textContent?.includes("Currency:")
  );
  if (currencyEl) {
    data.currency = currencyEl.textContent?.split(":")[1]?.trim();
  }

  // Extract supplier
  const supplierDiv = doc.querySelector(".supplier");
  if (supplierDiv) {
    const paragraphs = Array.from(supplierDiv.querySelectorAll("p"));
    data.supplier = {
      name: paragraphs[0]?.textContent?.trim(),
      address: paragraphs.slice(1).map(p => p.textContent?.trim()).join("\n")
    };
  }

  // Extract importer
  const importerDiv = doc.querySelector(".importer");
  if (importerDiv) {
    const paragraphs = Array.from(importerDiv.querySelectorAll("p"));
    data.importer = {
      name: paragraphs[0]?.textContent?.trim(),
      address: paragraphs.slice(1).map(p => p.textContent?.trim()).join("\n")
    };
  }

  // Extract totals
  const netTotalEl = Array.from(doc.querySelectorAll("p")).find(p => 
    p.textContent?.includes("Net Total:")
  );
  if (netTotalEl) {
    const match = netTotalEl.textContent?.match(/(\d+(?:\.\d+)?)/);
    if (match) {
      data.net_total = parseFloat(match[1]);
    }
  }

  const grossTotalEl = Array.from(doc.querySelectorAll("p")).find(p => 
    p.textContent?.includes("Gross Total:")
  );
  if (grossTotalEl) {
    const match = grossTotalEl.textContent?.match(/(\d+(?:\.\d+)?)/);
    if (match) {
      data.gross_total = parseFloat(match[1]);
    }
  }

  // Extract line items
  const tbody = doc.querySelector(".line-items tbody");
  if (tbody) {
    data.line_items = [];
    const rows = tbody.querySelectorAll("tr");
    rows.forEach(row => {
      const cells = row.querySelectorAll("td");
      if (cells.length >= 7) {
        data.line_items!.push({
          description: cells[0].textContent?.trim(),
          product_code: cells[1].textContent?.trim() || null,
          quantity: parseInt(cells[2].textContent?.trim() || "0"),
          unit_price: parseFloat(cells[3].textContent?.trim() || "0"),
          line_total: parseFloat(cells[4].textContent?.trim() || "0"),
          unit_type: cells[5].textContent?.trim(),
          hs_code: cells[6].textContent?.trim()
        });
      } else if (cells.length === 2) {
        // Simplified format (invoice-005)
        data.line_items!.push({
          description: cells[0].textContent?.trim(),
          line_total: parseFloat(cells[1].textContent?.trim() || "0")
        });
      }
    });
  }

  return data;
}

// Main execution
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: bun run mock_extractor.ts <input-file>");
  process.exit(1);
}

const inputFile = args[0];
const result = extractInvoiceData(inputFile);

// Output as JSON for AgentV to consume
console.log(JSON.stringify(result, null, 2));
