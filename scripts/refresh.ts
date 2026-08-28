/**
 * Data refresh entry point. The full FMP pipeline lands in Phase 2;
 * until then this exits loudly instead of half-working.
 */
console.error('refresh: the FMP pipeline is not implemented yet (arrives with Phase 2).');
console.error('The committed data/ snapshot is mock data from `npm run generate:mock`.');
process.exit(1);
