// TypeScript string formatting utilities — used as eval input files.
// This file intentionally has type-safety gaps for the agent to identify:
//   - All parameters typed as `any` instead of explicit types
//   - `var` declarations instead of `const`/`let`
//   - No explicit return type annotations on any function
//   - Old-style `for` loop instead of `for...of`

function formatCurrency(amount: any, currency: any) {
  var formatted = amount.toFixed(2);
  return currency + formatted;
}

function capitalize(str: any) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function truncate(text: any, maxLength: any) {
  if (text.length > maxLength) {
    return text.substring(0, maxLength) + '...';
  }
  return text;
}

function joinWords(words: any) {
  var result = '';
  for (var i = 0; i < words.length; i++) {
    if (i > 0) result += ' ';
    result += words[i];
  }
  return result;
}
